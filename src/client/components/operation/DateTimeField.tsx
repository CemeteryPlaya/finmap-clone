import { useState } from 'react';
import { formatDateTimeField, parseTimeInput } from '../../../shared/dates';
import { Calendar } from '../Calendar';
import { Field } from '../Field';
import { CalendarIcon, ClockIcon } from '../icons';
import { Popover } from '../Popover';
import { btnPrimary } from '../ui';

/** Кнопка поля с плавающей подписью (§6.3 этапа 1.5): высота 56 px, значение под подписью. */
const fieldButtonClass =
  'flex h-14 w-full items-center justify-between gap-2 rounded-xl bg-field px-4 pt-5 pb-1 text-left text-base outline-none focus:ring-2 focus:ring-focus disabled:opacity-60';

/**
 * Панель поля даты и времени: календарь (дни после сегодня недоступны) и строка «Время» с «Готово». Выбор дня сразу
 * ставит дату и панель не закрывает; время применяется по «Готово» или Enter, только если его меняли и оно не равно
 * показанному (иначе остаётся «живым» или прежним); неверное — ошибка в панели. Esc и уход из панели закрывают её
 * без применения набранного времени. На телефоне при открытии фокус на дне календаря, а не в поле времени: клавиатура
 * сама не выезжает; цели касания — не меньше 44 px.
 */
function DateTimePanel(props: {
  date: string;
  time: string;
  today: string;
  onDate: (date: string) => void;
  onTime: (time: string) => void;
  close: () => void;
}) {
  const [text, setText] = useState(props.time);
  const [edited, setEdited] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const apply = () => {
    if (edited) {
      const time = parseTimeInput(text);
      if (time === null) {
        setError('Введите время в виде ЧЧ:ММ');
        return;
      }
      // то же время, что уже в поле, не «задаётся руками»: «живое» время остаётся живым
      if (time !== props.time) props.onTime(time);
    }
    props.close();
  };
  return (
    <div>
      <Calendar value={props.date} today={props.today} max={props.today} onSelect={props.onDate} />
      <div className="mt-3 grid grid-cols-[auto_minmax(0,1fr)_auto] items-start gap-2 border-t border-field pt-3">
        <span aria-hidden="true" className="mt-8 text-muted">
          <ClockIcon />
        </span>
        <Field label="Время" error={error ?? undefined}>
          {(c) => (
            <input
              {...c}
              inputMode="numeric"
              autoComplete="off"
              placeholder="ЧЧ:ММ"
              value={text}
              onChange={(e) => {
                setText(e.target.value);
                setEdited(true);
                setError(null);
              }}
              onKeyDown={(e) => {
                // Enter применяет время и закрывает панель, а не отправляет форму
                if (e.key !== 'Enter') return;
                e.preventDefault();
                apply();
              }}
              // свои классы, а не inputClass + py-2: два значения отступа в одном классе Tailwind не перекрывают друг друга надёжно
              className="w-full rounded-xl bg-field px-4 py-2 outline-none focus:ring-2 focus:ring-focus pointer-coarse:h-11"
            />
          )}
        </Field>
        <button type="button" onClick={apply} className={`${btnPrimary} mt-6 pointer-coarse:h-11`}>
          Готово
        </button>
      </div>
    </div>
  );
}

/**
 * Дата и время оплаты (§2.3, §6.5 этапа 1.5): «Сегодня, 10.10.2026, 15:58», «Вчера, …», иначе день недели. Подпись —
 * по типу операции (§6.2), иконка календаря. Ввода с клавиатуры в само поле нет: день выбирается в календаре, время —
 * в строке «Время». `time` — время, которое сохранится (заданное руками, время операции или «сейчас»); `nowTime` —
 * «сейчас», его показывает поле, пока `time` пусто.
 */
export function DateTimeField(props: {
  label: string;
  date: string;
  time: string;
  nowTime: string;
  today: string;
  error?: string;
  hint?: string;
  disabled?: boolean;
  onDateChange: (date: string) => void;
  onTimeChange: (time: string) => void;
}) {
  const shownTime = props.time || props.nowTime;
  const shown = formatDateTimeField(props.date, shownTime, props.today);
  return (
    <Field label={props.label} error={props.error} hint={props.hint} floating filled>
      {(control) => (
        <Popover
          control={control}
          label={
            <>
              <span className="truncate">{shown}</span>
              <CalendarIcon />
            </>
          }
          ariaLabel={`${props.label}: ${shown}`}
          panelLabel={`${props.label}: календарь`}
          buttonClassName={fieldButtonClass}
          panelClassName="w-80"
          disabled={props.disabled}
        >
          {(close) => (
            <DateTimePanel
              date={props.date}
              time={shownTime}
              today={props.today}
              onDate={props.onDateChange}
              onTime={props.onTimeChange}
              close={() => close(true)}
            />
          )}
        </Popover>
      )}
    </Field>
  );
}
