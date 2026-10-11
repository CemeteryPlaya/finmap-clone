import { formatDateRu } from '../../shared/dates';
import { Calendar } from './Calendar';
import { Field } from './Field';
import { CalendarIcon } from './icons';
import { Popover } from './Popover';

export const dateButtonClass =
  'flex w-full items-center justify-between gap-2 rounded-xl bg-field px-4 py-2.5 text-left text-sm outline-none focus:ring-2 focus:ring-focus disabled:opacity-60';

/** Кнопка поля даты с плавающей подписью (§6.3 этапа 1.5): высота 56 px, значение под подписью. */
const floatingDateButtonClass =
  'flex h-14 w-full items-center justify-between gap-2 rounded-xl bg-field px-4 pt-5 pb-1 text-left text-base outline-none focus:ring-2 focus:ring-focus disabled:opacity-60';

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
  /** Подпись внутри поля (§6.3 этапа 1.5) — «Дата сделки» в форме операции. */
  floating?: boolean;
  error?: string;
}) {
  const shown = props.value ? formatDateRu(props.value) : null;
  return (
    <Field label={props.label} className={props.className} floating={props.floating} filled={shown !== null} error={props.error}>
      {(control) => (
        <Popover
          control={control}
          label={
            <>
              <span className={`truncate ${shown ? '' : 'text-muted'}`}>{shown ?? (props.floating ? '' : 'Не выбрана')}</span>
              <CalendarIcon />
            </>
          }
          ariaLabel={`${props.label}: ${shown ?? 'не выбрана'}`}
          panelLabel={`${props.label}: календарь`}
          buttonClassName={props.floating ? floatingDateButtonClass : dateButtonClass}
          panelClassName="w-72 pointer-coarse:w-[336px]"
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
