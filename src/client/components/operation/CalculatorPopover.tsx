import { useEffect, useRef } from 'react';
import { CALC_KEY_NAMES, CALC_ROWS, pressCalcKey } from '../../lib/calculator';
import { CalculatorIcon } from '../icons';
import { Popover } from '../Popover';

/**
 * Калькулятор (§6.10 этапа 1.5): иконка в поле суммы открывает панель — строку выражения (то же значение, что в поле)
 * и кнопки не меньше 44×44 px. Кнопки пишут в выражение поля; «=» вычисляет его (`onEquals` — то же, что уход из поля)
 * и закрывает панель — ошибка видна у поля. Esc закрывает панель и возвращает фокус на иконку.
 */
export function CalculatorPopover(props: { value: string; onChange: (text: string) => void; onEquals: () => void; onClose: () => void }) {
  return (
    <Popover
      label={<CalculatorIcon />}
      ariaLabel="Калькулятор"
      buttonClassName="grid size-11 place-items-center rounded-lg text-muted hover:bg-card focus-visible:outline-2 focus-visible:outline-focus"
      align="right"
      panelClassName="w-72"
      onClose={props.onClose}
    >
      {(close) => (
        <div>
          <Display text={props.value || '0'} />
          <div className="grid grid-cols-4 gap-1.5">
            {CALC_ROWS.flat().map((key) => (
              <button
                key={key}
                type="button"
                aria-label={CALC_KEY_NAMES[key]}
                onClick={() => {
                  if (key === '=') {
                    props.onEquals();
                    close(true);
                  } else props.onChange(pressCalcKey(props.value, key));
                }}
                className={`min-h-11 min-w-11 rounded-xl text-lg font-semibold outline-none focus-visible:ring-2 focus-visible:ring-focus ${
                  key === '=' ? 'bg-income-strong text-white' : /^[\d,]$/.test(key) ? 'bg-field' : 'bg-canvas'
                }`}
              >
                {key}
              </button>
            ))}
          </div>
        </div>
      )}
    </Popover>
  );
}

/** Строка выражения: длинное выражение прокручивается к концу — виден хвост, который набирает пользователь. */
function Display({ text }: { text: string }) {
  const ref = useRef<HTMLOutputElement>(null);
  useEffect(() => {
    if (ref.current) ref.current.scrollLeft = ref.current.scrollWidth;
  }, [text]);
  return (
    <output
      ref={ref}
      aria-live="polite"
      className="mb-2 block min-h-11 overflow-x-auto rounded-xl bg-field px-3 py-2 text-right text-xl font-semibold whitespace-nowrap tabular-nums"
    >
      {text}
    </output>
  );
}
