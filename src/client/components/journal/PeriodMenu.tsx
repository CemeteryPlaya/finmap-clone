import { useEffect, useId, useRef, useState } from 'react';
import { PERIODS, periodLabel, periodRange, withPeriod, type PeriodFields, type PeriodKey } from '../../lib/journal-filter';
import { DateField } from '../DateField';
import { Caret, Popover } from '../Popover';
import { btnPrimary } from '../ui';

export const pillClass =
  'inline-flex max-w-full items-center gap-2 rounded-full bg-field px-4 py-2 text-sm font-semibold text-ink hover:brightness-95 focus-visible:outline-2 focus-visible:outline-focus';

/** Меню периода во всю ширину поля — первое поле окна «Фильтры» на телефоне (§8.5 этапа 1.5, снимок Finmap m06). */
export const wideClass =
  'flex min-h-12 w-full items-center justify-between gap-2 rounded-xl bg-field px-4 text-sm font-semibold text-ink hover:brightness-95 focus-visible:outline-2 focus-visible:outline-focus';

/**
 * «Выбрать даты»: поля «С» и «По» с календарём; начинаются с границ выбранного периода (как прежнее «Произвольно»).
 * validate — свои ограничения (отчёты: обе даты, не больше 5 лет): текст ошибки под полями, «Применить» недоступна.
 */
function PeriodDates(props: {
  state: PeriodFields;
  today: string;
  onApply: (range: { from?: string; to?: string }) => void;
  validate?: (range: { from?: string; to?: string }) => string | null;
}) {
  const initial = periodRange(props.state, props.today);
  const [from, setFrom] = useState<string | null>(initial.from ?? null);
  const [to, setTo] = useState<string | null>(initial.to ?? null);
  const range = { ...(from ? { from } : {}), ...(to ? { to } : {}) };
  const error = props.validate?.(range) ?? null;
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
      {error && (
        <p role="status" className="text-sm text-expense-strong">
          {error}
        </p>
      )}
      <button type="button" disabled={(!from && !to) || error !== null} onClick={() => props.onApply(range)} className={btnPrimary}>
        Применить
      </button>
    </div>
  );
}

function PeriodPanel<S extends PeriodFields>(props: {
  state: S;
  today: string;
  onChange: (next: S) => void;
  close: (returnFocus?: boolean) => void;
  periods?: readonly S['period'][];
  heading?: string;
  validate?: (range: { from?: string; to?: string }) => string | null;
}) {
  const { state } = props;
  const [choosing, setChoosing] = useState(false);
  const headingId = useId();
  if (choosing) {
    return (
      <PeriodDates
        state={state}
        today={props.today}
        validate={props.validate}
        onApply={(range) => {
          props.onChange(withPeriod(state, 'custom', range));
          props.close(true);
        }}
      />
    );
  }
  const shown = props.periods ? PERIODS.filter((p) => (props.periods as readonly PeriodKey[]).includes(p.key)) : PERIODS;
  return (
    <>
      {/* видимый заголовок типа даты читается и как название списка (aria-labelledby), а не прячется от программ чтения */}
      {props.heading && (
        <p id={headingId} className="px-3 pt-1 pb-2 text-xs font-semibold tracking-wide text-muted uppercase">
          {props.heading}
        </p>
      )}
      <ul aria-labelledby={props.heading ? headingId : undefined} className="flex flex-col">
        {shown.map((p) => {
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
    </>
  );
}

/**
 * Пилюля периода (§5.1 этапа 1.5): «За все время ▾» открывает меню; пункты — кнопки, у текущего ✓ и
 * aria-current. «Выбрать даты» переключает ту же панель на поля «С» и «По» с календарём и «Применить».
 * Имя кнопки — «Период: {подпись}». Ключи периода в адресе прежние. Отчёты «Аналитики» (§2.3 спецификации «Аналитика»)
 * передают свой набор периодов, заголовок типа даты над ним и проверку своих дат.
 */
export function PeriodMenu<S extends PeriodFields>(props: {
  state: S;
  today: string;
  onChange: (next: S) => void;
  /** Во всю ширину — первое поле окна «Фильтры» на телефоне (§8.5 этапа 1.5). */
  wide?: boolean;
  /** Пункты меню; без них — все периоды журнала. */
  periods?: readonly S['period'][];
  /** Заголовок над пунктами: «ПО ДАТЕ ПЛАТЕЖА». */
  heading?: string;
  /** Проверка своих дат «С» и «По»: текст ошибки или null. */
  validate?: (range: { from?: string; to?: string }) => string | null;
}) {
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
      buttonClassName={props.wide ? wideClass : pillClass}
      panelClassName="w-72 pointer-coarse:w-[336px]"
    >
      {(close) => (
        <PeriodPanel state={props.state} today={props.today} onChange={props.onChange} close={close} periods={props.periods} heading={props.heading} validate={props.validate} />
      )}
    </Popover>
  );
}
