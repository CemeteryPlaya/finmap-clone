import { describe, expect, it } from 'vitest';
import { CALC_MAX_LENGTH, evaluateAmount } from '../../src/shared/calc';
import { CALC_KEY_NAMES, CALC_ROWS, pressCalcKey } from '../../src/client/lib/calculator';

describe('калькулятор поля суммы (§6.10 этапа 1.5)', () => {
  it('раскладка кнопок: 7 8 9 ÷ / 4 5 6 × / 1 2 3 − / 0 , = + / ( ) C ⌫; минус — U+2212', () => {
    expect(CALC_ROWS).toEqual([
      ['7', '8', '9', '÷'],
      ['4', '5', '6', '×'],
      ['1', '2', '3', '−'],
      ['0', ',', '=', '+'],
      ['(', ')', 'C', '⌫'],
    ]);
    expect(CALC_KEY_NAMES['−']).toBe('Минус');
    expect(CALC_KEY_NAMES['=']).toBe('Вычислить');
  });

  it('кнопки пишут в то же выражение; C очищает, ⌫ стирает последний символ', () => {
    let expr = '';
    for (const key of ['1', '5', '0', '0', '+', '2', '5', '0', '×', '2']) expr = pressCalcKey(expr, key);
    expect(expr).toBe('1500+250×2');
    expect(evaluateAmount(expr, 2)).toEqual({ ok: true, minor: 200000 });
    expect(pressCalcKey('12', '⌫')).toBe('1');
    expect(pressCalcKey('', '⌫')).toBe('');
    expect(pressCalcKey('12+3', 'C')).toBe('');
    expect(evaluateAmount(pressCalcKey('10', '−') + '4', 2)).toEqual({ ok: true, minor: 600 });
  });

  it('у предела длины выражение не растёт (Review Focus 5)', () => {
    const full = '1'.repeat(CALC_MAX_LENGTH);
    expect(pressCalcKey(full, '2')).toBe(full);
    expect(pressCalcKey(full, '⌫')).toHaveLength(CALC_MAX_LENGTH - 1);
  });
});
