import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useAutoFocus } from '../useAutoFocus';
import { CalculatorPopover } from './CalculatorPopover';
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

/** Подсказка поля суммы с калькулятором (§6.10 этапа 1.5). */
export const CALC_HINT = 'Можно писать выражения: 1500+250*2';

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
  /** Поставить фокус в поле при появлении, если он ничей (страница, окно, «×», элемент, сфокусированный окном при открытии); иначе не трогать. */
  autoFocus?: boolean;
  /** Поставить фокус в поле при каждом изменении значения (после «Добавить и создать похожий»). */
  refocusSignal?: number;
  className?: string;
  /** Иконка калькулятора в поле и подсказка про выражения (§6.10): у основной суммы формы. */
  calculator?: boolean;
}) {
  const ref = useRef<HTMLInputElement>(null);
  const calcBox = useRef<HTMLDivElement>(null);
  /** Нажатие на иконку идёт: Safari не фокусирует кнопку, relatedTarget пуст — поле не вычисляется до открытия калькулятора. */
  const openingCalc = useRef(false);
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

  // фокус в поле при появлении, если он «ничей» (окно только что открылось) — useAutoFocus
  useAutoFocus(ref, props.autoFocus);

  // явный возврат фокуса после «Добавить и создать похожий»: один раз, когда новое состояние уже в DOM
  useEffect(() => {
    if (props.refocusSignal) ref.current?.focus();
  }, [props.refocusSignal]);

  /** Вычислить выражение поля; true — результат записан (или поле пусто), false — ошибка показана у поля. */
  const evaluate = (): boolean => {
    if (props.value.trim() === '') return true;
    const r = positiveAmount(props.value, props.minorUnits);
    if (r.ok) props.onChange(amountInputText(r.minor, props.minorUnits));
    setCalcError(r.ok ? null : r.error);
    return r.ok;
  };

  // свежий evaluate для отложенного вызова (закрытие панели)
  const evaluateRef = useRef(evaluate);
  evaluateRef.current = evaluate;
  /** Кадр отложенного решения при закрытии панели: после размонтирования поля он не нужен. */
  const closeFrame = useRef(0);
  useEffect(() => () => cancelAnimationFrame(closeFrame.current), []);

  /** Узел — иконка калькулятора или его собственная панель (не любая панель: поле может стоять рядом с другими). */
  const inCalc = (node: Element | null) => {
    if (!node) return false;
    if (calcBox.current?.contains(node)) return true;
    const panel = node.closest('[data-popover-panel]');
    const owned = calcBox.current?.querySelector('button[aria-controls]')?.getAttribute('aria-controls');
    return !!panel && !!owned && panel.id === owned;
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
          className="min-h-11 rounded-xl bg-field py-2 text-lg font-semibold"
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
      hint={props.hint ?? (props.calculator && !props.disabled ? CALC_HINT : undefined)}
      className={props.className}
      floating
      filled={props.value !== ''}
      below={operators}
    >
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
            onBlur={(e) => {
              // фокус ушёл на иконку калькулятора или в его панель: выражение не вычисляется, его доработает калькулятор
              if (openingCalc.current || inCalc(e.relatedTarget as Element | null)) return;
              evaluate();
            }}
            // сумма — крупная, как раньше (text-lg): размер — отдельно от floatingControlBase
            className={`${floatingControlBase} text-lg font-semibold tabular-nums ${props.calculator && !props.disabled ? 'pr-14' : ''}`}
          />
          {props.calculator && !props.disabled && (
            <div
              ref={calcBox}
              className="absolute top-1/2 right-1.5 -translate-y-1/2"
              onPointerDown={() => {
                openingCalc.current = true;
                requestAnimationFrame(() => (openingCalc.current = false));
              }}
              onMouseDown={() => {
                openingCalc.current = true;
                requestAnimationFrame(() => (openingCalc.current = false));
              }}
              onBlur={(e) => {
                // фокус ушёл с иконки мимо поля и калькулятора при закрытой панели (Tab): поле вычисляется здесь,
                // потому что панель не открывалась и onClose не придёт; blur внутри панели закроет она сама
                if ((e.target as Element).closest('[data-popover-panel]')) return;
                const to = e.relatedTarget as Element | null;
                if (to === ref.current || inCalc(to)) return;
                if (calcBox.current?.querySelector('[aria-expanded="true"]')) return;
                evaluate();
              }}
            >
              <CalculatorPopover
                value={props.value}
                onChange={(text) => {
                  props.onChange(text);
                  setCalcError(null);
                }}
                onEquals={() => {
                  const ok = evaluate();
                  // ошибка: фокус — в поле, где она показана (и объявлена); иначе фокус вернётся на иконку
                  if (!ok) ref.current?.focus();
                  return ok;
                }}
                onClose={() => {
                  // после щелчка в поле фокус переходит в него не сразу: решаем в следующем кадре; в поле — вычислит его уход
                  cancelAnimationFrame(closeFrame.current);
                  closeFrame.current = requestAnimationFrame(() => {
                    if (document.activeElement !== ref.current) evaluateRef.current();
                  });
                }}
              />
            </div>
          )}
        </>
      )}
    </Field>
  );
}
