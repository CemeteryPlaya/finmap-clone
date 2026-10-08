import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { CALC_MAX_LENGTH } from '../../../shared/calc';
import { positiveAmount } from '../../lib/operation-form';
import { amountInputText } from '../../lib/journal-format';
import { Field } from '../Field';
import { inputClass } from '../ui';

/** Кнопки операторов под полем на телефоне: цифровая клавиатура их не показывает (§7). */
const OPERATORS = [
  { symbol: '+', name: 'плюс' },
  { symbol: '\u2212', name: 'минус' },
  { symbol: '×', name: 'умножение' },
  { symbol: '÷', name: 'деление' },
] as const;

/**
 * Поле суммы (§7): принимает выражение (`+ - × /`, скобки, запятая или точка) и вычисляет его при уходе
 * из поля — в поле остаётся результат, округлённый до минимальных единиц валюты. Ниже 768 px под полем —
 * ряд операторов; нажатие вставляет оператор в позицию курсора и не уводит фокус из поля.
 */
export function AmountField(props: {
  label: string;
  value: string;
  onChange: (text: string) => void;
  minorUnits: number;
  error?: string;
  hint?: string;
  disabled?: boolean;
  /** Поставить фокус в поле: при появлении и при каждом изменении значения (после «Сохранить и создать похожий»). */
  focusSignal?: number;
  className?: string;
}) {
  const ref = useRef<HTMLInputElement>(null);
  const [calcError, setCalcError] = useState<string | null>(null);
  /** Куда поставить курсор после вставки оператора — сразу после отрисовки нового значения. */
  const caret = useRef<number | null>(null);

  useLayoutEffect(() => {
    const input = ref.current;
    if (caret.current === null || !input) return;
    input.focus();
    input.setSelectionRange(caret.current, caret.current);
    caret.current = null;
  }, [props.value]);

  useEffect(() => {
    // кадр спустя: окно <dialog> к этому моменту уже открыто через showModal()
    if (!props.focusSignal) return;
    const frame = requestAnimationFrame(() => {
      const input = ref.current;
      const active = document.activeElement;
      // пользователь уже набирает в другом поле окна — фокус не перехватываем
      const typing = active instanceof HTMLElement && active !== input && active.matches('textarea, input:not([type="radio"]):not([type="checkbox"]):not([type="file"])');
      if (input && !typing) input.focus();
    });
    return () => cancelAnimationFrame(frame);
  }, [props.focusSignal]);

  const evaluate = () => {
    if (props.value.trim() === '') return;
    const r = positiveAmount(props.value, props.minorUnits);
    if (r.ok) props.onChange(amountInputText(r.minor, props.minorUnits));
    setCalcError(r.ok ? null : r.error);
  };

  const insert = (symbol: string) => {
    const input = ref.current;
    if (!input) return;
    const focused = document.activeElement === input;
    const start = focused ? (input.selectionStart ?? props.value.length) : props.value.length;
    const end = focused ? (input.selectionEnd ?? start) : start;
    caret.current = start + symbol.length;
    props.onChange(props.value.slice(0, start) + symbol + props.value.slice(end));
    setCalcError(null);
  };

  return (
    <Field label={props.label} error={props.error ?? calcError ?? undefined} hint={props.hint} className={props.className}>
      {(c) => (
        <>
          <input
            {...c}
            ref={ref}
            inputMode="decimal"
            autoComplete="off"
            maxLength={CALC_MAX_LENGTH}
            disabled={props.disabled}
            value={props.value}
            onChange={(e) => {
              props.onChange(e.target.value);
              setCalcError(null);
            }}
            onBlur={evaluate}
            placeholder="0"
            className={`${inputClass} text-lg font-semibold tabular-nums`}
          />
          {!props.disabled && (
            <div role="group" aria-label={`Операторы: ${props.label}`} className="mt-2 grid grid-cols-4 gap-2 md:hidden">
              {OPERATORS.map((op) => (
                <button
                  key={op.symbol}
                  type="button"
                  aria-label={`Оператор ${op.name}`}
                  // фокус остаётся в поле: выражение не вычисляется посреди набора
                  onPointerDown={(e) => e.preventDefault()}
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => insert(op.symbol)}
                  className="rounded-xl bg-field py-2 text-lg font-semibold"
                >
                  {op.symbol}
                </button>
              ))}
            </div>
          )}
        </>
      )}
    </Field>
  );
}
