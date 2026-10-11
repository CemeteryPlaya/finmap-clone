import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { CALC_MAX_LENGTH } from '../../../shared/calc';
import { positiveAmount } from '../../lib/operation-form';
import { amountInputText } from '../../lib/journal-format';
import { Field } from '../Field';
import { floatingControlBase } from '../ui';

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
  /** Поставить фокус в поле при появлении, если он ничей (страница, окно, радиокнопка); иначе не трогать. */
  autoFocus?: boolean;
  /** Поставить фокус в поле при каждом изменении значения (после «Сохранить и создать похожий»). */
  refocusSignal?: number;
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
    if (!props.autoFocus) return;
    const isRadio = (el: unknown) => el instanceof HTMLInputElement && el.type === 'radio';
    // «×» окна (Modal) — тоже «ничей» фокус: на ней он оказывается только до переноса на содержимое
    const isModalClose = (el: unknown) => el instanceof HTMLElement && el.hasAttribute('data-modal-close');
    let frame = 0;
    const stop = () => {
      cancelAnimationFrame(frame);
      document.removeEventListener('focusin', onFocusIn);
    };
    // пользователь уже выбрал что-то другое в окне — фокус не перехватываем
    const onFocusIn = (e: FocusEvent) => {
      if (e.target !== ref.current && !isRadio(e.target) && !isModalClose(e.target)) stop();
    };
    document.addEventListener('focusin', onFocusIn);
    frame = requestAnimationFrame(() => {
      stop();
      const active = document.activeElement;
      // фокус «ничей»: на странице, на самом окне, на «×» окна или на радиокнопке типа (туда его ставит showModal())
      const free = active === document.body || active instanceof HTMLDialogElement || isRadio(active) || isModalClose(active);
      if (free) ref.current?.focus();
    });
    return stop;
  }, [props.autoFocus]);

  // явный возврат фокуса после «Сохранить и создать похожий»: один раз, когда новое состояние уже в DOM
  useEffect(() => {
    if (props.refocusSignal) ref.current?.focus();
  }, [props.refocusSignal]);

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

  // ряд операторов — под рамкой поля (Field below), чтобы плавающая подпись стояла по центру самого поля
  const operators = props.disabled ? null : (
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
  );

  return (
    <Field
      label={props.label}
      error={props.error ?? calcError ?? undefined}
      hint={props.hint}
      className={props.className}
      floating
      filled={props.value !== ''}
      below={operators}
    >
      {(c) => (
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
          // сумма — крупная, как раньше (text-lg): размер — отдельно от floatingControlBase
          className={`${floatingControlBase} text-lg font-semibold tabular-nums`}
        />
      )}
    </Field>
  );
}
