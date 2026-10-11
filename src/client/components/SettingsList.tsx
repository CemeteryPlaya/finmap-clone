import { useId, useLayoutEffect, useRef, useState, type KeyboardEvent, type PointerEvent, type ReactNode } from 'react';
import { dropIndexAt, dropInGroup, moveGroup, movedText, shiftInGroup, visibleRows, type SettingsRow } from '../lib/settings-list';
import { GripIcon, PencilIcon, SearchIcon } from './icons';
import { btnPrimary, inputClass } from './ui';

/** Перетаскивание за ☰: кого тянем, его группа и место вставки среди остальных строк группы. */
interface Drag {
  id: number;
  group: number[];
  index: number;
}

const iconButton =
  'grid h-9 w-9 shrink-0 place-items-center rounded-lg text-muted hover:bg-card hover:text-ink focus-visible:outline-2 focus-visible:outline-focus';
const markBefore = 'shadow-[inset_0_2px_0_0_var(--color-focus)]';
const markAfter = 'shadow-[inset_0_-2px_0_0_var(--color-focus)]';

/**
 * Общий шаблон списка зоны настроек (§7.1 этапа 1.5): «Добавить …», «Поиск» во всю ширину, строки «☰ название,
 * серый текст, ✎» без рамки с разделителем снизу. Порядок — перетаскиванием за ☰ (события указателя с захватом:
 * мышь и касание одним кодом) или Alt+↑/↓ на ручке; итог объявляется в живой области. Строка двигается только
 * среди соседей своего уровня; архивные — в конце, приглушены, не двигаются; при поиске ручек нет.
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
  /** После Alt+↑/↓: вернуть фокус на ручку строки, пока порядок не станет новым (React мог переставить узел). */
  const refocus = useRef<{ id: number; order: number[] } | null>(null);
  const shown = visibleRows(props.rows, query);
  // при поиске видна только часть списка — порядок не меняют (§7.1)
  const reorderable = props.onReorder !== undefined && query.trim() === '';

  useLayoutEffect(() => {
    const want = refocus.current;
    if (!want) return;
    const handle = handles.current.get(want.id);
    const active = document.activeElement;
    // человек уже ушёл фокусом на другой элемент — не мешаем
    if (active && active !== document.body && active !== handle) {
      refocus.current = null;
      return;
    }
    if (handle && active !== handle) handle.focus({ preventScroll: true });
    if (moveGroup(shown, want.id).join() === want.order.join()) refocus.current = null;
  });

  const commit = (row: T, next: number[], keyboard: boolean) => {
    props.onReorder?.(next, row.id);
    setAnnounce(movedText(row.name, next, row.id));
    if (keyboard) refocus.current = { id: row.id, order: next };
  };

  const onHandleKey = (e: KeyboardEvent<HTMLButtonElement>, row: T) => {
    if (e.key === 'Escape' && drag) {
      e.preventDefault();
      setDrag(null);
      return;
    }
    if (!e.altKey || (e.key !== 'ArrowUp' && e.key !== 'ArrowDown')) return;
    e.preventDefault();
    const next = shiftInGroup(moveGroup(shown, row.id), row.id, e.key === 'ArrowUp' ? -1 : 1);
    if (next) commit(row, next, true);
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
    setDrag({ id: row.id, group, index: group.indexOf(row.id) });
  };

  const onPointerMove = (e: PointerEvent<HTMLButtonElement>) => {
    if (!drag) return;
    // середины строк — каждый раз заново: страница могла прокрутиться
    const index = dropIndexAt(midpoints(drag.group.filter((id) => id !== drag.id)), e.clientY);
    if (index !== drag.index) setDrag({ ...drag, index });
  };

  const onPointerUp = (row: T) => {
    if (!drag) return;
    const next = dropInGroup(drag.group, drag.id, drag.index);
    setDrag(null);
    if (next) commit(row, next, false);
  };

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
                className={`flex min-h-14 items-center gap-2 border-b border-field py-2 pr-1 hover:bg-field/60 ${child ? 'pl-9' : 'pl-1'} ${row.archived ? 'opacity-60' : ''} ${drag?.id === row.id ? 'opacity-50' : ''} ${before === row.id ? markBefore : ''} ${after === row.id ? markAfter : ''}`}
              >
                {movable ? (
                  <button
                    type="button"
                    ref={(el) => {
                      if (el) handles.current.set(row.id, el);
                      else handles.current.delete(row.id);
                    }}
                    aria-label={`Переместить ${row.name}`}
                    aria-describedby={hintId}
                    title="Перетащите, чтобы изменить порядок"
                    onPointerDown={(e) => onPointerDown(e, row)}
                    onPointerMove={onPointerMove}
                    onPointerUp={() => onPointerUp(row)}
                    onPointerCancel={() => setDrag(null)}
                    onKeyDown={(e) => onHandleKey(e, row)}
                    className={`${iconButton} cursor-grab touch-none select-none active:cursor-grabbing`}
                  >
                    <GripIcon />
                  </button>
                ) : (
                  props.onReorder && (
                    <span aria-hidden="true" className="grid h-9 w-9 shrink-0 place-items-center text-muted opacity-30">
                      <GripIcon />
                    </span>
                  )
                )}
                <span className="flex min-w-0 flex-1 flex-wrap items-baseline gap-x-2">
                  <span className={`min-w-0 truncate ${props.strong?.(row) ? 'font-semibold' : ''}`}>{row.name}</span>
                  {row.secondary && <span className="text-sm text-muted">{row.secondary}</span>}
                  {note && <span className="rounded-full bg-field px-2 py-0.5 text-xs text-muted">{note}</span>}
                </span>
                {props.actions?.(row)}
                {props.onEdit && (props.canEdit?.(row) ?? true) && (
                  <button
                    type="button"
                    data-edit-id={row.id}
                    aria-label={`Изменить ${row.name}`}
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
