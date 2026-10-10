import { useEffect, useRef, useState } from 'react';
import { PERIODS, periodLabel, periodRange, withPeriod, type JournalUrlState } from '../../lib/journal-filter';
import { DateField } from '../DateField';
import { Caret, Popover } from '../Popover';
import { btnPrimary } from '../ui';

export const pillClass =
  'inline-flex max-w-full items-center gap-2 rounded-full bg-field px-4 py-2 text-sm font-semibold text-ink hover:brightness-95 focus-visible:outline-2 focus-visible:outline-focus';

/** «Выбрать даты»: поля «С» и «По» с календарём; начинаются с границ выбранного периода (как прежнее «Произвольно»). */
function PeriodDates(props: { state: JournalUrlState; today: string; onApply: (range: { from?: string; to?: string }) => void }) {
  const initial = periodRange(props.state, props.today);
  const [from, setFrom] = useState<string | null>(initial.from ?? null);
  const [to, setTo] = useState<string | null>(initial.to ?? null);
  const ref = useRef<HTMLDivElement>(null);
  // пункт «Выбрать даты» исчез вместе со списком — фокус на поле «С», а не на <body>
  useEffect(() => {
    ref.current?.querySelector<HTMLElement>('button')?.focus();
  }, []);
  return (
    <div ref={ref} className="flex flex-col gap-3">
      <p className="text-sm font-semibold">Выбрать даты</p>
      <DateField label="С" value={from} today={props.today} onChange={setFrom} />
      <DateField label="По" value={to} today={props.today} onChange={setTo} />
      <button
        type="button"
        disabled={!from && !to}
        onClick={() => props.onApply({ ...(from ? { from } : {}), ...(to ? { to } : {}) })}
        className={btnPrimary}
      >
        Применить
      </button>
    </div>
  );
}

function PeriodPanel(props: { state: JournalUrlState; today: string; onChange: (next: JournalUrlState) => void; close: (returnFocus?: boolean) => void }) {
  const { state } = props;
  const [choosing, setChoosing] = useState(false);
  if (choosing) {
    return (
      <PeriodDates
        state={state}
        today={props.today}
        onApply={(range) => {
          props.onChange(withPeriod(state, 'custom', range));
          props.close(true);
        }}
      />
    );
  }
  return (
    <ul className="flex flex-col">
      {PERIODS.map((p) => {
        const current = p.key === state.period;
        return (
          <li key={p.key}>
            <button
              type="button"
              aria-current={current ? 'true' : undefined}
              // при открытии фокус — на текущем пункте
              data-autofocus={current ? '' : undefined}
              onClick={() => {
                if (p.key === 'custom') {
                  setChoosing(true);
                  return;
                }
                props.onChange(withPeriod(state, p.key));
                props.close(true);
              }}
              className={`flex w-full items-center justify-between gap-3 rounded-lg px-3 py-2 text-left text-sm hover:bg-field focus-visible:outline-2 focus-visible:outline-focus ${current ? 'font-semibold' : ''}`}
            >
              {p.label}
              {current && (
                <span aria-hidden="true" className="text-income">
                  ✓
                </span>
              )}
            </button>
          </li>
        );
      })}
    </ul>
  );
}

/**
 * Пилюля периода (§5.1 этапа 1.5): «За все время ▾» открывает меню; пункты — кнопки, у текущего ✓ и
 * aria-current. «Выбрать даты» переключает ту же панель на поля «С» и «По» с календарём и «Применить».
 * Имя кнопки — «Период: {подпись}». Ключи периода в адресе прежние.
 */
export function PeriodMenu(props: { state: JournalUrlState; today: string; onChange: (next: JournalUrlState) => void }) {
  const label = periodLabel(props.state);
  return (
    <Popover
      label={
        <>
          <span className="truncate">{label}</span>
          <Caret />
        </>
      }
      ariaLabel={`Период: ${label}`}
      panelLabel="Период"
      buttonClassName={pillClass}
      panelClassName="w-72"
    >
      {(close) => <PeriodPanel state={props.state} today={props.today} onChange={props.onChange} close={close} />}
    </Popover>
  );
}
