import { formatDateRu } from '../../shared/dates';
import { Calendar } from './Calendar';
import { Field } from './Field';
import { CalendarIcon } from './icons';
import { Popover } from './Popover';

export const dateButtonClass =
  'flex w-full items-center justify-between gap-2 rounded-xl bg-field px-4 py-2.5 text-left text-sm outline-none focus:ring-2 focus:ring-focus disabled:opacity-60';

/**
 * Поле даты (§6.5 этапа 1.5): кнопка с датой «04.10.2026» и иконкой календаря; открывает `Calendar` во всплывающей
 * панели, выбор дня закрывает её и возвращает фокус на поле. Ввода с клавиатуры в само поле нет — день выбирается
 * в сетке (стрелки, Enter). Имя кнопки — «{подпись}: {дата}», подпись `Field` связана с ней.
 */
export function DateField(props: {
  label: string;
  value: string | null;
  today: string;
  /** Дни после max недоступны (дата оплаты — не позже сегодня); у «Даты сделки» и периода журнала max нет. */
  max?: string;
  onChange: (date: string) => void;
  className?: string;
}) {
  const shown = props.value ? formatDateRu(props.value) : null;
  return (
    <Field label={props.label} className={props.className}>
      {(control) => (
        <Popover
          control={control}
          label={
            <>
              <span className={shown ? '' : 'text-muted'}>{shown ?? 'Не выбрана'}</span>
              <CalendarIcon />
            </>
          }
          ariaLabel={`${props.label}: ${shown ?? 'не выбрана'}`}
          panelLabel={`${props.label}: календарь`}
          buttonClassName={dateButtonClass}
          panelClassName="w-72"
        >
          {(close) => (
            <Calendar
              value={props.value}
              today={props.today}
              max={props.max}
              onSelect={(date) => {
                props.onChange(date);
                close(true);
              }}
            />
          )}
        </Popover>
      )}
    </Field>
  );
}
