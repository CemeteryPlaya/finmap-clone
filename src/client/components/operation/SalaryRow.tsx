import { useState } from 'react';
import { firstOfMonth } from '../../lib/operation-form';
import { HistoryIcon } from '../icons';
import { Popover } from '../Popover';
import { actionRowClass } from './ActionRow';

const MONTH_NAMES = ['Январь', 'Февраль', 'Март', 'Апрель', 'Май', 'Июнь', 'Июль', 'Август', 'Сентябрь', 'Октябрь', 'Ноябрь', 'Декабрь'];

/** Сетка месяцев: год «‹ ›», 12 месяцев (выбранный — aria-pressed, фокус при открытии — на активном), «Как дата оплаты». */
function MonthGrid(props: { selected: string | null; active: string; onPick: (date: string) => void; onClear: () => void }) {
  const [year, setYear] = useState(Number(props.active.slice(0, 4)));
  const nav = (label: string, sign: string, delta: number) => (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={() => setYear((y) => y + delta)}
      className="grid size-8 shrink-0 place-items-center rounded-lg text-sm font-semibold hover:bg-field focus-visible:outline-2 focus-visible:outline-focus"
    >
      <span aria-hidden="true">{sign}</span>
    </button>
  );
  return (
    <div>
      <div className="mb-2 flex items-center gap-1">
        {nav('Предыдущий год', '‹', -1)}
        <p aria-live="polite" className="min-w-0 flex-1 text-center text-sm font-semibold">
          {year}
        </p>
        {nav('Следующий год', '›', 1)}
      </div>
      <div className="grid grid-cols-3 gap-1">
        {MONTH_NAMES.map((name, i) => {
          const key = `${year}-${String(i + 1).padStart(2, '0')}`;
          const selected = key === props.selected;
          return (
            <button
              key={name}
              type="button"
              aria-pressed={selected}
              aria-label={`${name} ${year}`}
              data-autofocus={key === props.active ? '' : undefined}
              onClick={() => props.onPick(firstOfMonth(year, i + 1))}
              className={`min-h-11 rounded-lg px-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-focus ${selected ? 'bg-income font-semibold text-white' : 'hover:bg-field'}`}
            >
              {name}
            </button>
          );
        })}
      </div>
      <button type="button" onClick={props.onClear} className="mt-2 w-full rounded-lg px-3 py-2 text-sm font-semibold text-income-strong hover:bg-field">
        Как дата оплаты
      </button>
    </div>
  );
}

/**
 * «{Категория} за {месяц}» (§6.7 строка 1а этапа 1.5) — вместо «Дата сделки отличается» у зарплаты: строка вида ActionRow,
 * нажатие открывает выбор месяца. Месяц пишет дату сделки первым числом месяца, «Как дата оплаты» её убирает.
 */
export function SalaryRow(props: {
  text: string;
  muted: boolean;
  /** `YYYY-MM` выбранного месяца (даты сделки) или null. */
  selectedMonth: string | null;
  /** `YYYY-MM`, с которого открывается панель: выбранный месяц, иначе месяц даты оплаты. */
  activeMonth: string;
  onPick: (date: string) => void;
  onClear: () => void;
  /** Только просмотр (архивная компания): строка видна, но не открывается. */
  disabled?: boolean;
}) {
  return (
    <div className="border-b border-field">
      <Popover
        disabled={props.disabled}
        label={
          <>
            <span aria-hidden="true" className="grid size-6 shrink-0 place-items-center text-muted">
              <HistoryIcon />
            </span>
            <span className={`min-w-0 flex-1 ${props.muted ? 'text-muted' : ''}`}>{props.text}</span>
          </>
        }
        ariaLabel={props.text}
        panelLabel="Месяц начисления"
        buttonClassName={`${actionRowClass} text-ink`}
        panelClassName="w-72"
      >
        {(close) => (
          <MonthGrid
            selected={props.selectedMonth}
            active={props.activeMonth}
            onPick={(date) => {
              props.onPick(date);
              close(true);
            }}
            onClear={() => {
              props.onClear();
              close(true);
            }}
          />
        )}
      </Popover>
    </div>
  );
}
