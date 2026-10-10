import { useEffect, useId, useRef, useState, type KeyboardEvent } from 'react';
import { addMonths, longDateRu, monthTitle, monthWeeks, moveDate, sameMonth, WEEKDAYS } from '../lib/calendar';

/** Подсказка у дней после max (§6.5 этапа 1.5). */
export const AFTER_MAX_HINT = 'Плановые платежи появятся позже';

/**
 * Сетка месяца (§6.5, §11 этапа 1.5) — шаблон WAI-ARIA «date picker dialog»: таблица role="grid", в порядке Tab
 * один день (roving tabindex), он же получает фокус при открытии (`data-autofocus`, см. Popover). Стрелки — день
 * и неделя, PageUp/PageDown — месяц, Shift+PageUp/PageDown — год, Home/End — начало и конец недели, Enter и пробел —
 * выбор. Дни после max недоступны (aria-disabled) и не выбираются. Заголовок месяца — aria-live: смена месяца
 * слышна. Неделя с понедельника, дни соседних месяцев приглушены, сегодня обведено.
 */
export function Calendar(props: { value: string | null; today: string; max?: string; onSelect: (date: string) => void }) {
  const [active, setActive] = useState(() => props.value ?? (props.max !== undefined && props.today > props.max ? props.max : props.today));
  const gridRef = useRef<HTMLTableElement>(null);
  // фокус переезжает на новый день только после клавиш сетки; кнопки «‹ ›» оставляют его на себе
  const moveFocus = useRef(false);
  const titleId = useId();

  useEffect(() => {
    if (!moveFocus.current) return;
    moveFocus.current = false;
    gridRef.current?.querySelector<HTMLElement>('[tabindex="0"]')?.focus();
  }, [active]);

  const blocked = (d: string) => props.max !== undefined && d > props.max;
  const choose = (d: string) => {
    if (!blocked(d)) props.onSelect(d);
  };
  const onKeyDown = (e: KeyboardEvent<HTMLTableCellElement>, d: string) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      choose(d);
      return;
    }
    const next = moveDate(d, e.key, e.shiftKey);
    if (next === null) return;
    e.preventDefault();
    moveFocus.current = true;
    setActive(next);
  };
  const nav = (label: string, sign: string, months: number) => (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={() => setActive((a) => addMonths(a, months))}
      className="grid size-8 shrink-0 place-items-center rounded-lg text-sm font-semibold hover:bg-field focus-visible:outline-2 focus-visible:outline-focus"
    >
      <span aria-hidden="true">{sign}</span>
    </button>
  );

  return (
    <div>
      <div className="mb-2 flex items-center gap-1">
        {nav('Предыдущий год', '«', -12)}
        {nav('Предыдущий месяц', '‹', -1)}
        <p id={titleId} aria-live="polite" className="min-w-0 flex-1 text-center text-sm font-semibold uppercase">
          {monthTitle(active)}
        </p>
        {nav('Следующий месяц', '›', 1)}
        {nav('Следующий год', '»', 12)}
      </div>
      <table ref={gridRef} role="grid" aria-labelledby={titleId} className="w-full border-collapse text-center text-sm">
        <thead>
          <tr>
            {WEEKDAYS.map((w) => (
              <th key={w.short} scope="col" abbr={w.long} className="pb-1 text-xs font-medium text-muted">
                {w.short}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {monthWeeks(active).map((week) => (
            <tr key={week[0]}>
              {week.map((d) => {
                const off = blocked(d);
                const selected = d === props.value;
                return (
                  <td
                    key={d}
                    role="gridcell"
                    tabIndex={d === active ? 0 : -1}
                    data-autofocus={d === active ? '' : undefined}
                    aria-selected={selected}
                    aria-disabled={off || undefined}
                    aria-current={d === props.today ? 'date' : undefined}
                    aria-label={longDateRu(d)}
                    title={off ? AFTER_MAX_HINT : undefined}
                    onClick={() => {
                      setActive(d);
                      choose(d);
                    }}
                    onKeyDown={(e) => onKeyDown(e, d)}
                    className={[
                      'h-9 rounded-lg outline-none focus-visible:ring-2 focus-visible:ring-focus',
                      selected ? 'bg-income font-semibold text-white' : 'hover:bg-field',
                      !selected && d === props.today ? 'ring-1 ring-inset ring-income' : '',
                      !selected && !sameMonth(d, active) ? 'text-muted' : '',
                      off ? 'cursor-not-allowed opacity-40' : 'cursor-pointer',
                    ].join(' ')}
                  >
                    {Number(d.slice(8))}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
