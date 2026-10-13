import { useEffect, useId, useState, type KeyboardEvent } from 'react';
import { createItemLabel, initialActive, pickerItems, type PickerItem, type PickerOption } from '../lib/picker';
import { Popover } from './Popover';
import { badgeClass } from './ui';

export type { PickerOption } from '../lib/picker';

/** id пункта списка — для aria-activedescendant поля. */
export const pickerItemId = (listId: string, it: PickerItem): string => (it.kind === 'option' ? `${listId}-${it.option.id}` : `${listId}-create`);

/**
 * Список вариантов (шаблон combobox + listbox, §6.6 этапа 1.5) без поля ввода: поле — у владельца (`PickerList`,
 * поле со списком формы), фокус всегда в нём, активный пункт — `aria-activedescendant`. Пункты `py-3 text-base`;
 * у варианта справа — бейдж («системная») и символ валюты, оба только для глаз (имя пункта — название); варианты
 * с `section` собираются в группы (`role="group"` с названием). Нажатие мышью не уводит фокус из поля.
 */
export function PickerListbox(props: {
  id: string;
  label: string;
  items: readonly PickerItem[];
  active: number;
  /** Уже выбранное значение: отмечено `aria-selected`. */
  selectedId?: number | null;
  /** Что создаёт пункт «+ Создать»: «категорию». */
  createNoun?: string;
  onChoose: (it: PickerItem) => void;
  onHover: (index: number) => void;
  className?: string;
}) {
  const current = props.items.length > 0 ? props.items[Math.min(props.active, props.items.length - 1)] : undefined;
  const currentId = current ? pickerItemId(props.id, current) : null;

  useEffect(() => {
    if (currentId) document.getElementById(currentId)?.scrollIntoView({ block: 'nearest' });
  }, [currentId]);

  // подряд идущие пункты одной группы — вместе; пункты без группы и «+ Создать» — сами по себе
  const groups: { section?: string; entries: { it: PickerItem; i: number }[] }[] = [];
  props.items.forEach((it, i) => {
    const section = it.kind === 'option' ? it.option.section : undefined;
    const last = groups[groups.length - 1];
    if (section && last?.section === section) last.entries.push({ it, i });
    else groups.push({ section, entries: [{ it, i }] });
  });

  const optionItem = ({ it, i }: { it: PickerItem; i: number }) => {
    const selected = it.kind === 'option' && it.option.id === props.selectedId;
    const disabled = it.kind === 'option' && it.option.disabled === true;
    return (
      <li
        key={pickerItemId(props.id, it)}
        id={pickerItemId(props.id, it)}
        role="option"
        aria-selected={selected}
        aria-disabled={disabled || undefined}
        // фокус остаётся в поле ввода
        onMouseDown={(e) => e.preventDefault()}
        onMouseEnter={() => props.onHover(i)}
        onClick={() => props.onChoose(it)}
        className={`flex items-center gap-2 rounded-lg px-3 py-3 text-base ${disabled ? 'cursor-not-allowed text-muted' : 'cursor-pointer'} ${it === current ? 'bg-field' : ''} ${selected ? 'font-semibold' : ''} ${it.kind === 'create' ? 'font-medium text-income-strong' : ''}`}
      >
        <span className="min-w-0 flex-1 truncate">{it.kind === 'option' ? it.option.label : createItemLabel(it.name, props.createNoun ?? '')}</span>
        {it.kind === 'option' && it.option.badge && (
          <span aria-hidden="true" className={badgeClass}>
            {it.option.badge}
          </span>
        )}
        {it.kind === 'option' && it.option.suffix && (
          <span aria-hidden="true" className="shrink-0 text-label">
            {it.option.suffix}
          </span>
        )}
      </li>
    );
  };

  return (
    <ul id={props.id} role="listbox" aria-label={props.label} className={props.className}>
      {groups.map((g) =>
        g.section ? (
          <li key={`section-${g.entries[0]!.i}`} role="group" aria-label={g.section}>
            <span aria-hidden="true" className="block px-3 pt-2 pb-1 text-xs font-semibold text-muted">
              {g.section}
            </span>
            <ul role="none">{g.entries.map(optionItem)}</ul>
          </li>
        ) : (
          g.entries.map(optionItem)
        ),
      )}
    </ul>
  );
}

/**
 * Список с полем поиска (шаблон combobox + listbox): фокус в поле поиска, стрелки двигают активный пункт
 * (`aria-activedescendant`), Enter выбирает, Esc закрывает. При открытии активен уже выбранный пункт
 * (`selectedId`, у него `aria-selected`). Поиск — без учёта регистра и «ё» (§6.1). Пункта «+ Создать» здесь нет:
 * создание из списка — у полей формы (`useComboList`).
 */
export function PickerList(props: {
  label: string;
  options: PickerOption[];
  onPick: (id: number) => void;
  /** Уже выбранное значение: активно при открытии, отмечено `aria-selected`. */
  selectedId?: number | null;
}) {
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(() => initialActive(pickerItems(props.options, ''), props.selectedId));
  const listId = useId();
  const items = pickerItems(props.options, query);
  const current = items.length > 0 ? items[Math.min(active, items.length - 1)] : undefined;

  const choose = (it: PickerItem) => {
    if (it.kind === 'option' && !it.option.disabled) props.onPick(it.option.id);
  };

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActive((a) => Math.max(0, Math.min(a + 1, items.length - 1)));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActive((a) => Math.max(a - 1, 0));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (current) choose(current);
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
        aria-activedescendant={current ? pickerItemId(listId, current) : undefined}
        value={query}
        onChange={(e) => {
          // новый запрос — снова первый найденный пункт (сброс здесь, а не в эффекте: эффект при открытии затёр бы выбранный пункт)
          setQuery(e.target.value);
          setActive(initialActive(pickerItems(props.options, e.target.value), undefined));
        }}
        onKeyDown={onKeyDown}
        placeholder="Поиск"
        className="mb-2 w-full rounded-xl bg-field px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-focus"
      />
      <PickerListbox
        id={listId}
        label={props.label}
        items={items}
        active={active}
        selectedId={props.selectedId}
        onChoose={choose}
        onHover={setActive}
        className="max-h-60 overflow-y-auto"
      />
      {items.length === 0 && <p className="px-3 py-1.5 text-sm text-muted">Ничего не найдено</p>}
    </div>
  );
}

/** Кнопка с выпадающим списком с поиском: «Применить шаблон» в разбиении. */
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
