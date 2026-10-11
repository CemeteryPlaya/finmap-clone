import { useEffect, useId, useState, type KeyboardEvent } from 'react';
import { foldCase, matchesQuery } from '../../shared/search';
import type { PickerOption } from '../lib/picker';
import { Popover } from './Popover';

export type { PickerOption } from '../lib/picker';

type Item = { kind: 'option'; option: PickerOption } | { kind: 'create'; name: string };

/**
 * Список с поиском (шаблон combobox + listbox): фокус в поле поиска, стрелки двигают активный пункт
 * (`aria-activedescendant`), Enter выбирает, Esc закрывает. При открытии активен уже выбранный пункт
 * (`selectedId`, у него `aria-selected`). Поиск — без учёта регистра и «ё» (тем же правилом, что сервер, §6.1).
 * Варианты с `section` собираются в группы (`role="group"` с названием). С `onCreate` последним пунктом идёт
 * «+ Создать „…“», если такого названия ещё нет (§7).
 */
export function PickerList(props: {
  label: string;
  options: PickerOption[];
  onPick: (id: number) => void;
  onCreate?: (name: string) => void;
  /** Уже выбранное значение: активно при открытии, отмечено `aria-selected`. */
  selectedId?: number | null;
}) {
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(() => Math.max(0, props.options.findIndex((o) => o.id === props.selectedId)));
  const listId = useId();
  const shown = props.options.filter((o) => matchesQuery(o.label, query));
  const name = query.trim();
  const exists = props.options.some((o) => foldCase(o.label) === foldCase(name));
  const items: Item[] = [
    ...shown.map((option) => ({ kind: 'option' as const, option })),
    ...(props.onCreate && name !== '' && !exists ? [{ kind: 'create' as const, name }] : []),
  ];
  const itemId = (it: Item) => (it.kind === 'option' ? `${listId}-${it.option.id}` : `${listId}-create`);
  const current = items[Math.min(active, items.length - 1)];
  // подряд идущие пункты одной группы — вместе; пункты без группы и «+ Создать» — сами по себе
  const groups: { section?: string; entries: { it: Item; i: number }[] }[] = [];
  items.forEach((it, i) => {
    const section = it.kind === 'option' ? it.option.section : undefined;
    const last = groups[groups.length - 1];
    if (section && last?.section === section) last.entries.push({ it, i });
    else groups.push({ section, entries: [{ it, i }] });
  });

  useEffect(() => {
    if (current) document.getElementById(itemId(current))?.scrollIntoView({ block: 'nearest' });
  }, [current && itemId(current)]);

  const choose = (it: Item) => (it.kind === 'option' ? props.onPick(it.option.id) : props.onCreate?.(it.name));

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActive((a) => Math.min(a + 1, items.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActive((a) => Math.max(a - 1, 0));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (current) choose(current);
    }
  };

  const optionItem = ({ it, i }: { it: Item; i: number }) => {
    const selected = it.kind === 'option' && it.option.id === props.selectedId;
    return (
      <li
        key={itemId(it)}
        id={itemId(it)}
        role="option"
        aria-selected={selected}
        // фокус остаётся в поле поиска
        onMouseDown={(e) => e.preventDefault()}
        onMouseEnter={() => setActive(i)}
        onClick={() => choose(it)}
        className={`cursor-pointer truncate rounded-lg px-3 py-1.5 text-sm ${it === current ? 'bg-field' : ''} ${selected ? 'font-semibold' : ''} ${it.kind === 'create' ? 'font-medium text-income' : ''}`}
      >
        {it.kind === 'option' ? it.option.label : `+ Создать „${it.name}“`}
      </li>
    );
  };

  return (
    <div>
      <input
        role="combobox"
        aria-label={`${props.label}: поиск`}
        aria-expanded="true"
        aria-controls={listId}
        aria-autocomplete="list"
        aria-activedescendant={current ? itemId(current) : undefined}
        value={query}
        onChange={(e) => {
          // новый запрос — снова первый пункт (сброс здесь, а не в эффекте: эффект при открытии затёр бы выбранный пункт)
          setQuery(e.target.value);
          setActive(0);
        }}
        onKeyDown={onKeyDown}
        placeholder="Поиск"
        className="mb-2 w-full rounded-xl bg-field px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-focus"
      />
      <ul id={listId} role="listbox" aria-label={props.label} className="max-h-60 overflow-y-auto">
        {groups.map((g) =>
          g.section ? (
            <li key={`section-${g.entries[0]!.i}`} role="group" aria-label={g.section}>
              <span aria-hidden="true" className="block px-3 pb-1 pt-2 text-xs font-semibold text-muted">
                {g.section}
              </span>
              <ul role="none">{g.entries.map(optionItem)}</ul>
            </li>
          ) : (
            g.entries.map(optionItem)
          ),
        )}
      </ul>
      {items.length === 0 && <p className="px-3 py-1.5 text-sm text-muted">Ничего не найдено</p>}
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
  /** «+ Создать „…“»: создаёт элемент с набранным названием (§7). */
  onCreate?: (name: string) => void;
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
          onCreate={
            props.onCreate &&
            ((name) => {
              close(true);
              props.onCreate!(name);
            })
          }
        />
      )}
    </Popover>
  );
}
