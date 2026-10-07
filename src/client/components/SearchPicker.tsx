import { useEffect, useId, useState, type KeyboardEvent } from 'react';
import { matchesQuery } from '../../shared/search';
import { Popover } from './Popover';

export interface PickerOption {
  id: number;
  label: string;
}

/**
 * Список с поиском (шаблон combobox + listbox): фокус в поле поиска, стрелки двигают выбор,
 * Enter выбирает, Esc закрывает. Поиск — без учёта регистра и «ё» (тем же правилом, что сервер, §6.1).
 */
function PickerList(props: { label: string; options: PickerOption[]; onPick: (id: number) => void }) {
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const listId = useId();
  const shown = props.options.filter((o) => matchesQuery(o.label, query));
  const optionId = (o: PickerOption) => `${listId}-${o.id}`;
  const current = shown[Math.min(active, shown.length - 1)];

  useEffect(() => setActive(0), [query]);
  useEffect(() => {
    if (current) document.getElementById(optionId(current))?.scrollIntoView({ block: 'nearest' });
  }, [current?.id]);

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActive((a) => Math.min(a + 1, shown.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActive((a) => Math.max(a - 1, 0));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (current) props.onPick(current.id);
    }
  };

  return (
    <div>
      <input
        role="combobox"
        aria-label={`${props.label}: поиск`}
        aria-expanded="true"
        aria-controls={listId}
        aria-autocomplete="list"
        aria-activedescendant={current ? optionId(current) : undefined}
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        onKeyDown={onKeyDown}
        placeholder="Поиск"
        className="mb-2 w-full rounded-xl bg-field px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-focus"
      />
      <ul id={listId} role="listbox" aria-label={props.label} className="max-h-60 overflow-y-auto">
        {shown.map((o) => (
          <li
            key={o.id}
            id={optionId(o)}
            role="option"
            aria-selected={o === current}
            // фокус остаётся в поле поиска
            onMouseDown={(e) => e.preventDefault()}
            onMouseEnter={() => setActive(shown.indexOf(o))}
            onClick={() => props.onPick(o.id)}
            className={`cursor-pointer truncate rounded-lg px-3 py-1.5 text-sm ${o === current ? 'bg-field' : ''}`}
          >
            {o.label}
          </li>
        ))}
      </ul>
      {shown.length === 0 && <p className="px-3 py-1.5 text-sm text-muted">Ничего не найдено</p>}
    </div>
  );
}

/** Кнопка с выпадающим списком с поиском: «Указать» в ячейке журнала, выбор для массового действия. */
export function SearchPicker(props: {
  label: string;
  ariaLabel?: string;
  /** Название списка для программ чтения с экрана. */
  listLabel: string;
  options: PickerOption[];
  onPick: (id: number) => void;
  buttonClassName?: string;
  align?: 'left' | 'right';
  /** Недоступна без потери фокуса (aria-disabled) — см. Popover. */
  inactive?: boolean;
}) {
  return (
    <Popover
      label={props.label}
      ariaLabel={props.ariaLabel}
      buttonClassName={props.buttonClassName}
      align={props.align}
      inactive={props.inactive}
      panelClassName="w-72"
    >
      {(close) => (
        <PickerList
          label={props.listLabel}
          options={props.options}
          onPick={(id) => {
            close(true);
            props.onPick(id);
          }}
        />
      )}
    </Popover>
  );
}
