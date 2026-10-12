import { useEffect, useId, useLayoutEffect, useRef, useState, type KeyboardEvent, type PointerEvent, type ReactNode } from 'react';
import { dropIndexAt, dropInGroup, edgeScrollStep, moveGroup, movedText, shiftInGroup, visibleRows, type SettingsRow } from '../lib/settings-list';
import { GripIcon, PencilIcon, SearchIcon } from './icons';
import { btnPrimary, inputClass, rowIconClass as iconButton, settingsRowClass } from './ui';

/** Перетаскивание за ☰: кого тянем, его группа и место вставки среди остальных строк группы. */
interface Drag {
  id: number;
  group: number[];
  index: number;
}

const markBefore = 'shadow-[inset_0_2px_0_0_var(--color-focus)]';
const markAfter = 'shadow-[inset_0_-2px_0_0_var(--color-focus)]';

/**
 * Что прокручивает перетаскивание у края (итоги 1.5-4a): ближайший предок с прокруткой (окно «Счета»); в окне без
 * прокрутки — ничего (страница под окном не должна ехать); иначе страница — без нижней панели вкладок (§8.3),
 * которая закрывает низ экрана на телефоне.
 */
function scrollAreaOf(el: HTMLElement): { top: number; bottom: number; scroll: (dy: number) => void } | null {
  for (let p = el.parentElement; p; p = p.parentElement) {
    const node = p;
    const overflow = getComputedStyle(node).overflowY;
    if ((overflow === 'auto' || overflow === 'scroll') && node.scrollHeight > node.clientHeight) {
      const r = node.getBoundingClientRect();
      return { top: r.top, bottom: r.bottom, scroll: (dy) => node.scrollBy(0, dy) };
    }
    if (node instanceof HTMLDialogElement) return null;
  }
  const bar = document.querySelector<HTMLElement>('[data-tab-bar]');
  const barTop = bar && bar.getClientRects().length > 0 ? bar.getBoundingClientRect().top : window.innerHeight;
  return { top: 0, bottom: Math.min(window.innerHeight, barTop), scroll: (dy) => window.scrollBy(0, dy) };
}

/**
 * Общий шаблон списка зоны настроек (§7.1 этапа 1.5): «Добавить …», «Поиск» во всю ширину, строки «☰ название,
 * серый текст, ✎» без рамки с разделителем снизу. Порядок — перетаскиванием за ☰ (события указателя с захватом:
 * мышь и касание одним кодом; у края области прокрутки список едет сам) или Alt+↑/↓ на ручке; итог объявляется
 * в живой области. Строка двигается только среди соседей своего уровня; архивные — в конце, приглушены,
 * не двигаются; при поиске ручек нет.
 * Без ролей status, alert, region: ошибки и пометки показывает страница.
 */
export function SettingsList<T extends SettingsRow>(props: {
  /** Доступное имя списка. */
  label: string;
  rows: readonly T[];
  /** Главная кнопка под заголовком; null — без кнопки (компания в архиве, системные категории). */
  addLabel: string | null;
  onAdd?: () => void;
  /** Поле «Поиск» (по умолчанию есть; в окне «Счета» — нет). */
  search?: boolean;
  /** Новый порядок группы (соседи одного уровня без архивных, в порядке показа). Нет — без ☰. */
  onReorder?: (group: number[], movedId: number) => void;
  /** ✎ «Изменить {название}». Нет — без ✎. */
  onEdit?: (row: T) => void;
  /** false — у строки нет ✎ (системная категория). */
  canEdit?: (row: T) => boolean;
  /** Иконки перед ✎ («+» подкатегории, «банк» системной категории). */
  actions?: (row: T) => ReactNode;
  /** Название полужирным (категории верхнего уровня). */
  strong?: (row: T) => boolean;
  /** Текст пустого списка. */
  empty: string;
}) {
  const [query, setQuery] = useState('');
  const [drag, setDrag] = useState<Drag | null>(null);
  const [announce, setAnnounce] = useState('');
  const hintId = useId();
  const rowEls = useRef(new Map<number, HTMLLIElement>());
  const handles = useRef(new Map<number, HTMLButtonElement>());
  /** Ручка, на которой был фокус: после перестановки или отката React мог переставить узел и фокус упал на body. */
  const lastHandle = useRef<number | null>(null);
  /** Где сейчас указатель, пока строку тянут: прокрутка у края идёт и без новых движений пальца. */
  const pointerY = useRef<number | null>(null);
  const shown = visibleRows(props.rows, query);
  // при поиске видна только часть списка — порядок не меняют (§7.1)
  const reorderable = props.onReorder !== undefined && query.trim() === '';

  useLayoutEffect(() => {
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

  // Esc отменяет перетаскивание, где бы ни был фокус
  const dragging = drag !== null;
  useEffect(() => {
    if (!dragging) return;
    // в фазе перехвата и без стандартного действия: иначе Esc закрыл бы ещё и окно «Счета» (нативный cancel диалога)
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.preventDefault();
      e.stopPropagation();
      setDrag(null);
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [dragging]);

  const commit = (row: T, next: number[]) => {
    props.onReorder?.(next, row.id);
    setAnnounce(movedText(row.name, next, row.id));
  };

  const onHandleKey = (e: KeyboardEvent<HTMLButtonElement>, row: T) => {
    if (!e.altKey || (e.key !== 'ArrowUp' && e.key !== 'ArrowDown')) return;
    e.preventDefault();
    const next = shiftInGroup(moveGroup(shown, row.id), row.id, e.key === 'ArrowUp' ? -1 : 1);
    if (next) commit(row, next);
  };

  const midpoints = (ids: number[]) =>
    ids.map((id) => {
      const r = rowEls.current.get(id)?.getBoundingClientRect();
      return r ? r.top + r.height / 2 : 0;
    });

  const onPointerDown = (e: PointerEvent<HTMLButtonElement>, row: T) => {
    if (e.button !== 0) return;
    const group = moveGroup(shown, row.id);
    if (group.length < 2) return;
    // без выделения текста и «мышиных» событий; дальше указатель привязан к ручке, даже если ушёл со строки
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    // preventDefault выше отменил и фокус — ставим на ручку сами
    e.currentTarget.focus({ preventScroll: true });
    lastHandle.current = row.id;
    pointerY.current = e.clientY;
    setDrag({ id: row.id, group, index: group.indexOf(row.id) });
  };

  const onPointerMove = (e: PointerEvent<HTMLButtonElement>) => {
    if (!drag) return;
    pointerY.current = e.clientY;
    // середины строк — каждый раз заново: страница могла прокрутиться
    const index = dropIndexAt(midpoints(drag.group.filter((id) => id !== drag.id)), e.clientY);
    if (index !== drag.index) setDrag({ ...drag, index });
  };

  const onPointerUp = () => {
    if (!drag) return;
    const row = shown.find((r) => r.id === drag.id);
    const next = dropInGroup(drag.group, drag.id, drag.index);
    setDrag(null);
    if (row && next) commit(row, next);
  };

  // у края области прокрутки список едет сам, пока строку держат (палец может стоять на месте); место вставки —
  // заново после каждого шага прокрутки
  const dragId = drag?.id ?? null;
  useEffect(() => {
    if (dragId === null) return;
    let frame = 0;
    const tick = () => {
      const row = rowEls.current.get(dragId);
      const y = pointerY.current;
      const area = row && y !== null ? scrollAreaOf(row) : null;
      const step = area && y !== null ? edgeScrollStep(y, area.top, area.bottom) : 0;
      if (area && y !== null && step !== 0) {
        area.scroll(step);
        setDrag((d) => {
          if (!d) return d;
          const index = dropIndexAt(midpoints(d.group.filter((id) => id !== d.id)), y);
          return index === d.index ? d : { ...d, index };
        });
      }
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [dragId]);

  // где встанет строка: черта над строкой (или под последней); на прежнем месте — без черты
  let before: number | undefined;
  let after: number | undefined;
  if (drag && dropInGroup(drag.group, drag.id, drag.index) !== null) {
    const others = drag.group.filter((id) => id !== drag.id);
    before = others[drag.index];
    if (drag.index === others.length) after = others[others.length - 1];
  }

  return (
    <div>
      {props.addLabel !== null && props.onAdd && (
        <button type="button" data-settings-add="" onClick={props.onAdd} className={`${btnPrimary} mb-4`}>
          {props.addLabel}
        </button>
      )}
      {props.search !== false && (
        <div className="relative mb-2">
          <span aria-hidden="true" className="pointer-events-none absolute top-1/2 left-4 -translate-y-1/2 text-label">
            <SearchIcon />
          </span>
          <input type="search" aria-label="Поиск" placeholder="Поиск" value={query} onChange={(e) => setQuery(e.target.value)} className={`${inputClass} pl-11`} />
        </div>
      )}
      <p id={hintId} className="sr-only">
        Alt и стрелка вверх или вниз — переместить строку; мышью или пальцем — перетащить за ручку.
      </p>
      <p aria-live="polite" className="sr-only">
        {announce}
      </p>
      {shown.length === 0 ? (
        <p className="py-4 text-muted">{props.rows.length === 0 ? props.empty : 'Ничего не найдено.'}</p>
      ) : (
        <ul aria-label={props.label}>
          {shown.map((row) => {
            const child = row.parentId != null && shown.some((r) => r.id === row.parentId);
            const movable = reorderable && !row.archived && moveGroup(shown, row.id).length > 1;
            const note = row.note ?? (row.archived ? 'в архиве' : null);
            return (
              <li
                key={row.id}
                ref={(el) => {
                  if (el) rowEls.current.set(row.id, el);
                  else rowEls.current.delete(row.id);
                }}
                className={`${settingsRowClass} ${child ? 'pl-9' : 'pl-1'} ${drag?.id === row.id ? 'opacity-50' : ''} ${before === row.id ? markBefore : ''} ${after === row.id ? markAfter : ''}`}
              >
                {movable ? (
                  <button
                    type="button"
                    ref={(el) => {
                      if (el) handles.current.set(row.id, el);
                      else handles.current.delete(row.id);
                    }}
                    aria-label={row.moveLabel ?? `Переместить ${row.name}`}
                    aria-describedby={hintId}
                    title="Перетащите, чтобы изменить порядок"
                    onPointerDown={(e) => onPointerDown(e, row)}
                    onPointerMove={onPointerMove}
                    onPointerUp={onPointerUp}
                    onPointerCancel={() => setDrag(null)}
                    onLostPointerCapture={() => setDrag(null)}
                    onFocus={() => (lastHandle.current = row.id)}
                    onBlur={(e) => {
                      if (e.relatedTarget) lastHandle.current = null;
                    }}
                    data-grip=""
                    onKeyDown={(e) => onHandleKey(e, row)}
                    className={`${iconButton} cursor-grab touch-none select-none active:cursor-grabbing`}
                  >
                    <GripIcon />
                  </button>
                ) : (
                  props.onReorder && (
                    <span aria-hidden="true" className="grid h-9 w-9 shrink-0 place-items-center text-muted opacity-30 max-md:size-11">
                      <GripIcon />
                    </span>
                  )
                )}
                <span className="flex min-w-0 flex-1 flex-wrap items-baseline gap-x-2">
                  <span className={`min-w-0 truncate ${props.strong?.(row) ? 'font-semibold' : ''} ${row.archived ? 'text-label' : ''}`}>{row.name}</span>
                  {row.secondary && <span className="text-sm text-muted">{row.secondary}</span>}
                  {note && <span className="rounded-full bg-field px-2 py-0.5 text-xs text-label">{note}</span>}
                </span>
                {props.actions?.(row)}
                {props.onEdit && (props.canEdit?.(row) ?? true) && (
                  <button
                    type="button"
                    data-edit-id={row.id}
                    aria-label={row.editLabel ?? `Изменить ${row.name}`}
                    title="Изменить"
                    onClick={() => props.onEdit!(row)}
                    className={iconButton}
                  >
                    <PencilIcon />
                  </button>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
