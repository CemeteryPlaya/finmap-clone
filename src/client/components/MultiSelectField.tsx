import { useEffect, useRef, useState } from 'react';
import { matchesQuery } from '../../shared/search';
import type { MultiOption } from '../lib/journal-filter-dialog';
import { Popover } from './Popover';

const fieldClass = 'flex w-full min-w-0 items-center justify-between gap-2 rounded-xl bg-field px-4 py-2 text-left outline-none focus:ring-2 focus:ring-focus';

function MultiPanel(props: { label: string; options: MultiOption[]; selected: readonly string[]; onToggle: (key: string) => void }) {
  const [query, setQuery] = useState('');
  const searchRef = useRef<HTMLInputElement>(null);
  // снятый «Недоступный элемент» пропадает из списка вместе с флажком: фокус не теряется, а уходит на поиск (Esc и Tab остаются в панели)
  useEffect(() => {
    if (document.activeElement === document.body) searchRef.current?.focus();
  }, [props.options]);
  // отмеченные видны и при поиске — их можно снять
  const shown = props.options.filter((o) => props.selected.includes(o.key) || matchesQuery(o.label, query));
  const groups: { section?: string; items: MultiOption[] }[] = [];
  for (const o of shown) {
    const last = groups[groups.length - 1];
    if (o.section && last?.section === o.section) last.items.push(o);
    else groups.push({ section: o.section, items: [o] });
  }
  const item = (o: MultiOption) => (
    <label key={o.key} className={`flex min-w-0 items-center gap-2 rounded-lg px-2 py-1.5 text-sm hover:bg-field ${o.nested ? 'pl-7' : ''}`}>
      <input type="checkbox" checked={props.selected.includes(o.key)} onChange={() => props.onToggle(o.key)} className="size-4 shrink-0 accent-income" />
      {/* длинное название без пробелов переносится, а не растягивает панель */}
      <span className="min-w-0 [overflow-wrap:anywhere]">{o.label}</span>
    </label>
  );
  return (
    <div>
      <input
        ref={searchRef}
        type="search"
        aria-label={`${props.label}: поиск`}
        placeholder="Поиск"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        // Enter в поиске ничего не применяет
        onKeyDown={(e) => {
          if (e.key === 'Enter') e.preventDefault();
        }}
        className="mb-2 w-full rounded-xl bg-field px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-focus"
      />
      <div className="max-h-72 overflow-y-auto">
        {groups.map((g, i) =>
          g.section ? (
            <fieldset key={`${g.section}-${i}`} className="mb-1 min-w-0">
              <legend className="px-2 pt-2 pb-1 text-xs font-semibold text-muted">{g.section}</legend>
              {g.items.map(item)}
            </fieldset>
          ) : (
            <div key={`plain-${i}`}>{g.items.map(item)}</div>
          ),
        )}
        {shown.length === 0 && <p className="px-2 py-1.5 text-sm text-muted">Ничего не найдено</p>}
      </div>
    </div>
  );
}

/**
 * Выпадающий мультивыбор (§5.6 этапа 1.5): кнопка поля — сверху подпись со счётчиком «Проекты (1)», ниже значение
 * («Все проекты» или названия через запятую с обрезкой); панель — поиск (без учёта регистра и «ё») и флажки,
 * группы — `fieldset` с названием. Флажки — обычные `checkbox`: множественный выбор без особой клавиатурной схемы.
 * Esc закрывает только панель (Popover), окно остаётся.
 */
export function MultiSelectField(props: { label: string; allLabel: string; options: MultiOption[]; selected: readonly string[]; onToggle: (key: string) => void }) {
  const count = props.selected.length;
  const title = count > 0 ? `${props.label} (${count})` : props.label;
  const chosen = props.options.filter((o) => props.selected.includes(o.key)).map((o) => o.label);
  const value = chosen.length > 0 ? chosen.join(', ') : props.allLabel;
  return (
    <Popover
      label={
        <>
          <span className="flex min-w-0 flex-col">
            <span className="text-xs text-muted">{title}</span>
            <span className="truncate text-sm">{value}</span>
          </span>
          <span aria-hidden="true" className="text-muted">
            ▾
          </span>
        </>
      }
      ariaLabel={`${title}: ${value}`}
      panelLabel={props.label}
      buttonClassName={fieldClass}
      panelClassName="w-80 max-w-[calc(100vw-2rem)]"
    >
      {() => <MultiPanel label={props.label} options={props.options} selected={props.selected} onToggle={props.onToggle} />}
    </Popover>
  );
}
