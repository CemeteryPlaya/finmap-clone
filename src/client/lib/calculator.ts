import { CALC_MAX_LENGTH } from '../../shared/calc';

/** Кнопки калькулятора по строкам (§6.10 этапа 1.5); минус — U+2212, как у ряда операторов поля суммы. */
export const CALC_ROWS: readonly (readonly string[])[] = [
  ['7', '8', '9', '÷'],
  ['4', '5', '6', '×'],
  ['1', '2', '3', '−'],
  ['0', ',', '=', '+'],
  ['(', ')', 'C', '⌫'],
];

/** Имена кнопок для программ чтения (у цифр имя — сама цифра). */
export const CALC_KEY_NAMES: Readonly<Record<string, string>> = {
  '÷': 'Деление',
  '×': 'Умножение',
  '−': 'Минус',
  '+': 'Плюс',
  '=': 'Вычислить',
  ',': 'Запятая',
  '(': 'Открыть скобку',
  ')': 'Закрыть скобку',
  C: 'Очистить',
  '⌫': 'Стереть символ',
};

/** Нажатие кнопки, кроме «=»: выражение поля после нажатия. C — очистить, ⌫ — стереть последний символ; длиннее CALC_MAX_LENGTH не растёт. */
export function pressCalcKey(expr: string, key: string): string {
  if (key === 'C') return '';
  if (key === '⌫') return expr.slice(0, -1);
  const next = expr + key;
  return next.length > CALC_MAX_LENGTH ? expr : next;
}
