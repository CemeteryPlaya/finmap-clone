import { useEffect, useId, useLayoutEffect, useRef, useState, type KeyboardEvent, type PointerEvent } from 'react';
import { EXPORT_COLUMNS, EXPORT_GROUPS, exportColumnLabel, type ExportColumnId } from '../../../shared/export-columns';
import {
  columnPositionText,
  columnRemovedText,
  dropExportColumn,
  EXPORT_COLUMNS_PREF,
  focusIndexAfterRemove,
  savedExportColumns,
  shiftExportColumn,
  toggleExportColumn,
} from '../../lib/export-columns';
import { journalApiParams, journalExportHref, type JournalUrlState } from '../../lib/journal-filter';
import { useExportPreview, usePreferences, savePreference } from '../../lib/queries';
import { dropIndexAt, edgeScrollStep } from '../../lib/settings-list';
import { GripIcon } from '../icons';
import { Modal } from '../Modal';
import { btnPrimary, btnSecondary } from '../ui';

/** Чип «Что выгрузить»: включённый — с галочкой и цветом дохода, выключенный — серый. */
const chipClass = (on: boolean) =>
  `rounded-full px-3 py-1.5 text-sm font-medium hover:brightness-95 focus-visible:outline-2 focus-visible:outline-focus ${on ? 'bg-income-soft text-ink' : 'bg-field text-muted'}`;

/** Кнопка в заголовке колонки: ручка и «×». */
const headerButton =
  'grid size-7 shrink-0 place-items-center rounded-md text-muted hover:bg-card hover:text-ink focus-visible:outline-2 focus-visible:outline-focus';

/** Перетаскивание за ручку: кого тянем и место вставки среди остальных колонок. */
interface Drag {
  id: ExportColumnId;
  index: number;
}

/** Кадр при 60 Гц, мс: на него рассчитан EDGE_SCROLL_MAX; предел длины кадра — после паузы вкладки прокрутка не прыгает. */
const FRAME_MS = 1000 / 60;
const MAX_FRAME_MS = 50;

const markBefore = 'shadow-[inset_2px_0_0_0_var(--color-focus)]';
const markAfter = 'shadow-[inset_-2px_0_0_0_var(--color-focus)]';

/**
 * Превью: заголовки колонок в выбранном порядке и первые операции фильтра. Тексты ячеек присылает сервер — они совпадают
 * с файлом (период начисления, знак суммы, «; » у разбитой операции, остатки).
 *
 * Порядок меняется перетаскиванием за ручку ⠿ (события указателя с захватом, как в списках настроек: мышь и касание одним
 * кодом; у края таблицы она едет сама) или Alt+← / Alt+→ на ручке; «×» убирает колонку. Итог перестановки и «×» объявляется
 * в живой области. Esc отменяет перетаскивание.
 */
function Preview(props: {
  columns: readonly ExportColumnId[];
  params: string;
  companyId: number;
  onReorder: (next: ExportColumnId[]) => void;
  onRemove: (id: ExportColumnId) => void;
  /** Убрали последнюю колонку: фокус некуда — страница переводит его на чипы. */
  onEmptied: () => void;
}) {
  const { columns } = props;
  const preview = useExportPreview(props.companyId, props.params);
  const rows = preview.data?.rows ?? [];
  const [drag, setDrag] = useState<Drag | null>(null);
  const [announce, setAnnounce] = useState('');
  const hintId = useId();
  const scrollRef = useRef<HTMLDivElement>(null);
  const cells = useRef(new Map<ExportColumnId, HTMLTableCellElement>());
  const handles = useRef(new Map<ExportColumnId, HTMLButtonElement>());
  const columnsRef = useRef(columns);
  columnsRef.current = columns;
  /** Ручка, на которой был фокус: после перестановки React мог переставить узел, и фокус упал на body. */
  const lastHandle = useRef<ExportColumnId | null>(null);
  /** После «×» — номер заголовка, куда перевести фокус. */
  const focusIndex = useRef<number | null>(null);
  /** Где сейчас указатель, пока колонку тянут: прокрутка у края идёт и без новых движений. */
  const pointerX = useRef<number | null>(null);
  /** Указатель, захваченный ручкой: его отпускаем явно при Esc, отпускании и отмене. */
  const pointerId = useRef<number | null>(null);

  useLayoutEffect(() => {
    if (focusIndex.current !== null) {
      const id = columns[focusIndex.current];
      focusIndex.current = null;
      if (id) handles.current.get(id)?.focus({ preventScroll: false });
      return;
    }
    if (lastHandle.current === null) return;
    const active = document.activeElement;
    // фокус потерян (body) — возвращаем на ручку; ушёл на другой элемент — не мешаем
    if (active && active !== document.body) return;
    handles.current.get(lastHandle.current)?.focus({ preventScroll: true });
  });

  // щелчок мимо ручек забывает ручку: иначе обновление списка вернуло бы на неё фокус
  useEffect(() => {
    const forget = (e: globalThis.PointerEvent) => {
      if (!(e.target instanceof Element) || !e.target.closest('[data-grip]')) lastHandle.current = null;
    };
    window.addEventListener('pointerdown', forget);
    return () => window.removeEventListener('pointerdown', forget);
  }, []);

  // Esc отменяет перетаскивание, где бы ни был фокус: в фазе перехвата и без стандартного действия — иначе Esc закрыл бы ещё и окно
  const dragging = drag !== null;
  const dragId = drag?.id ?? null;
  useEffect(() => {
    if (!dragging) return;
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.preventDefault();
      e.stopPropagation();
      release(dragId);
      setDrag(null);
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [dragging, dragId]);

  /** Отпустить захват указателя ручкой (если он ещё есть). */
  function release(id: ExportColumnId | null) {
    const el = id === null ? undefined : handles.current.get(id);
    const pid = pointerId.current;
    pointerId.current = null;
    if (el && pid !== null && el.hasPointerCapture(pid)) el.releasePointerCapture(pid);
  }

  /** Место вставки колонки id среди остальных при указателе в точке x: середины заголовков читаются заново (таблица могла прокрутиться). */
  function indexAt(x: number, id: ExportColumnId): number {
    const mids = columnsRef.current
      .filter((c) => c !== id)
      .map((c) => {
        const r = cells.current.get(c)?.getBoundingClientRect();
        return r ? r.left + r.width / 2 : 0;
      });
    return dropIndexAt(mids, x);
  }

  // у края таблицы она едет сама, пока колонку держат (палец может стоять на месте); место вставки — заново после шага
  useEffect(() => {
    if (dragId === null) return;
    let frame = 0;
    let last = 0;
    let carry = 0;
    const tick = (now: number) => {
      // шаг рассчитан на 60 кадров/с: на 120 Гц кадр вдвое короче, и шаг вдвое меньше; долю пикселя переносим на следующий кадр
      const dt = last ? Math.min(now - last, MAX_FRAME_MS) : FRAME_MS;
      last = now;
      const box = scrollRef.current;
      const x = pointerX.current;
      const rect = box?.getBoundingClientRect();
      const step = box && rect && x !== null ? edgeScrollStep(x, rect.left, rect.right) : 0;
      carry = step === 0 ? 0 : carry + (step * dt) / FRAME_MS;
      const whole = Math.trunc(carry);
      carry -= whole;
      if (box && x !== null && whole !== 0) {
        box.scrollBy(whole, 0);
        const index = indexAt(x, dragId);
        setDrag((d) => (d && d.index !== index ? { ...d, index } : d));
      }
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [dragId]);

  const commit = (next: ExportColumnId[], id: ExportColumnId) => {
    props.onReorder(next);
    setAnnounce(columnPositionText(next, id));
  };

  const onHandleKey = (e: KeyboardEvent<HTMLButtonElement>, id: ExportColumnId) => {
    if (!e.altKey || e.ctrlKey || e.shiftKey || e.metaKey || (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight')) return;
    // Alt+← в браузере — «назад»: без стандартного действия
    e.preventDefault();
    const next = shiftExportColumn(columns, id, e.key === 'ArrowLeft' ? -1 : 1);
    if (next) commit(next, id);
  };

  const onPointerDown = (e: PointerEvent<HTMLButtonElement>, id: ExportColumnId) => {
    if (e.button !== 0 || columns.length < 2) return;
    // без выделения текста и «мышиных» событий; дальше указатель привязан к ручке, даже если ушёл с заголовка
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    pointerId.current = e.pointerId;
    // preventDefault выше отменил и фокус — ставим на ручку сами
    e.currentTarget.focus({ preventScroll: true });
    lastHandle.current = id;
    pointerX.current = e.clientX;
    setDrag({ id, index: columns.indexOf(id) });
  };

  const onPointerMove = (e: PointerEvent<HTMLButtonElement>) => {
    if (!drag) return;
    pointerX.current = e.clientX;
    const index = indexAt(e.clientX, drag.id);
    if (index !== drag.index) setDrag({ ...drag, index });
  };

  const onPointerUp = () => {
    if (!drag) return;
    const next = dropExportColumn(columns, drag.id, drag.index);
    const id = drag.id;
    release(id);
    setDrag(null);
    if (next) commit(next, id);
  };

  const onPointerCancel = () => {
    release(dragId);
    setDrag(null);
  };

  const remove = (id: ExportColumnId) => {
    focusIndex.current = focusIndexAfterRemove(columns, id);
    lastHandle.current = null;
    props.onRemove(id);
    setAnnounce(columnRemovedText(id, columns.length - 1));
    if (focusIndex.current === null) props.onEmptied();
  };

  const status = preview.error
    ? ''
    : preview.data === undefined
      ? 'Загрузка…'
      : rows.length === 0
        ? 'По фильтру журнала операций нет — в файле будут только заголовки.'
        : '';

  // где встанет колонка: черта слева от заголовка (или справа от последнего); на прежнем месте — без черты
  let before: ExportColumnId | undefined;
  let after: ExportColumnId | undefined;
  if (drag && dropExportColumn(columns, drag.id, drag.index) !== null) {
    const others = columns.filter((c) => c !== drag.id);
    before = others[drag.index];
    if (drag.index === others.length) after = others[others.length - 1];
  }

  return (
    <div>
      <p id={hintId} className="sr-only">
        Alt и стрелка влево или вправо — переместить колонку; мышью или пальцем — перетащить за ручку.
      </p>
      <p aria-live="polite" className="sr-only">
        {announce}
      </p>
      <div ref={scrollRef} data-preview-scroll="" className="overflow-x-auto rounded-xl bg-field">
        <table aria-label="Превью файла" className="w-full border-collapse text-left text-sm">
          <thead>
            <tr>
              {columns.map((id) => {
                const label = exportColumnLabel(id);
                return (
                  <th
                    key={id}
                    scope="col"
                    ref={(el) => {
                      if (el) cells.current.set(id, el);
                      else cells.current.delete(id);
                    }}
                    className={`min-w-44 px-2 py-2 font-semibold ${drag?.id === id ? 'opacity-50' : ''} ${before === id ? markBefore : ''} ${after === id ? markAfter : ''}`}
                  >
                    <div className="flex items-center gap-1">
                      <button
                        type="button"
                        ref={(el) => {
                          if (el) handles.current.set(id, el);
                          else handles.current.delete(id);
                        }}
                        aria-label={`Переместить колонку ${label}`}
                        aria-describedby={hintId}
                        title="Перетащите, чтобы изменить порядок"
                        data-grip=""
                        onPointerDown={(e) => onPointerDown(e, id)}
                        onPointerMove={onPointerMove}
                        onPointerUp={onPointerUp}
                        onPointerCancel={onPointerCancel}
                        onLostPointerCapture={() => setDrag(null)}
                        onFocus={() => (lastHandle.current = id)}
                        onBlur={(e) => {
                          if (e.relatedTarget) lastHandle.current = null;
                        }}
                        onKeyDown={(e) => onHandleKey(e, id)}
                        className={`${headerButton} cursor-grab touch-none select-none active:cursor-grabbing`}
                      >
                        <GripIcon />
                      </button>
                      <span data-column-label="" className="min-w-0 flex-1 whitespace-nowrap">
                        {label}
                      </span>
                      <button type="button" aria-label={`Убрать колонку ${label}`} title="Убрать колонку" onClick={() => remove(id)} className={headerButton}>
                        <span aria-hidden="true">×</span>
                      </button>
                    </div>
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, i) => (
              <tr key={i} className="border-t border-card">
                {columns.map((id) => (
                  <td key={id} className="max-w-64 truncate px-3 py-1.5" title={row[id]}>
                    {row[id]}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {preview.error ? (
        <p role="alert" className="mt-2 text-sm text-expense-strong">
          Не удалось загрузить превью: {preview.error.message}
        </p>
      ) : null}
      {/* живая область смонтирована всегда и заполняется текстом: заранее заполненную при появлении читалки не объявляют */}
      <p role="status" className={status ? 'mt-2 text-sm text-muted' : 'sr-only'}>
        {status}
      </p>
      <p className="mt-2 text-xs text-muted">В файле — все операции по фильтру журнала и строка «Итого».</p>
      <p className="mt-1 text-xs text-muted">Переводы входят в «Итого» без знака.</p>
    </div>
  );
}

function BuilderBody(props: { companyId: number; state: JournalUrlState; today: string; onClose: () => void }) {
  const prefs = usePreferences();
  // набор из настройки пользователя; окно монтируется заново при каждом открытии, поэтому читается один раз
  // настройки загружаются при старте приложения, поэтому окно не пересинхронизирует набор позже
  const [columns, setColumns] = useState<ExportColumnId[]>(() => savedExportColumns(prefs.data?.[EXPORT_COLUMNS_PREF]));
  const params = journalApiParams(props.state, props.today).toString();
  const empty = columns.length === 0;
  const hintId = useId();
  const chips = useRef<HTMLDivElement>(null);
  const downloaded = useRef(false);

  return (
    <div>
      <p className="mb-3 text-sm text-muted">Перетащите заголовок колонки, чтобы изменить порядок. В превью — первые операции журнала.</p>
      <Preview
        columns={columns}
        params={params}
        companyId={props.companyId}
        onReorder={setColumns}
        onRemove={(id) => setColumns((cols) => toggleExportColumn(cols, id))}
        onEmptied={() => chips.current?.querySelector('button')?.focus()}
      />

      <h3 className="mt-6 mb-2 text-xs font-semibold tracking-wide text-label uppercase">Что выгрузить</h3>
      <div ref={chips} className="flex flex-col gap-3">
        {EXPORT_GROUPS.map((group) => (
          <div key={group.id} role="group" aria-label={group.label} className="flex flex-wrap items-center gap-2">
            <span aria-hidden="true" className="w-full text-xs font-semibold tracking-wide text-label uppercase md:w-44">
              {group.label}
            </span>
            {EXPORT_COLUMNS.filter((c) => c.group === group.id).map((c) => (
              <button key={c.id} type="button" aria-pressed={columns.includes(c.id)} onClick={() => setColumns((cols) => toggleExportColumn(cols, c.id))} className={chipClass(columns.includes(c.id))}>
                <span aria-hidden="true">{columns.includes(c.id) ? '✓ ' : ''}</span>
                {c.label}
              </button>
            ))}
          </div>
        ))}
      </div>

      <div className="mt-6 flex flex-wrap items-center justify-end gap-3 border-t border-field pt-4">
        {empty && (
          <p id={hintId} className="mr-auto text-sm text-muted">
            Выберите хотя бы одну колонку.
          </p>
        )}
        <button type="button" onClick={props.onClose} className={btnSecondary}>
          Отмена
        </button>
        {/* ссылка-скачивание: без побочных эффектов на сервере; набор запоминается при нажатии (§8.3) */}
        <a
          href={journalExportHref(props.companyId, props.state, props.today, 'custom', columns)}
          download
          aria-disabled={empty || undefined}
          aria-describedby={empty ? hintId : undefined}
          onClick={(e) => {
            // aria-disabled не гасит нажатие
            if (empty || downloaded.current) {
              e.preventDefault();
              return;
            }
            downloaded.current = true;
            // запомнить набор — удобство, а не условие скачивания: сбой записи файл не отменяет; пока настройки не загружены,
            // окно начало с набора по умолчанию — им нельзя затирать сохранённый набор
            if (prefs.data !== undefined) void savePreference(EXPORT_COLUMNS_PREF, columns).catch(() => undefined);
            // закрыть после того, как браузер начал скачивание: ссылка до этого должна остаться в странице
            setTimeout(props.onClose, 0);
          }}
          className={`${btnPrimary} inline-block aria-disabled:cursor-not-allowed aria-disabled:opacity-50`}
        >
          Собрать файл
        </a>
      </div>
    </div>
  );
}

/**
 * «Собрать Excel» (§8.3 спецификации импорта): превью файла с перестановкой и «×», чипы «Что выгрузить» по группам,
 * «Отмена» и «Собрать файл». Только компьютер. Набор колонок и порядок запоминаются в настройке `export.columns` при
 * «Собрать файл».
 */
export function ExportBuilderDialog(props: { open: boolean; onClose: () => void; companyId: number; state: JournalUrlState; today: string }) {
  return (
    <Modal open={props.open} title="Собрать Excel" onClose={props.onClose} className="max-w-[1280px]">
      <BuilderBody companyId={props.companyId} state={props.state} today={props.today} onClose={props.onClose} />
    </Modal>
  );
}
