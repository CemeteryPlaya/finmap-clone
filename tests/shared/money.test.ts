import { describe, expect, it } from 'vitest';
import { allocate, formatAmount, parseAmount } from '../../src/shared/money';

describe('parseAmount', () => {
  it('запятая или точка, пробелы, знак минус → минимальные единицы', () => {
    expect(parseAmount('1 500,50', 2)).toBe(150050);
    expect(parseAmount('1\u202F500.5', 2)).toBe(150050);
    expect(parseAmount('0', 2)).toBe(0);
    expect(parseAmount(',5', 2)).toBe(50);
    expect(parseAmount('-10', 2)).toBe(-1000);
    expect(parseAmount('\u221210', 2)).toBe(-1000);
    expect(parseAmount('-0', 2)).toBe(0);
    expect(parseAmount('100', 0)).toBe(100);
    expect(parseAmount('1,234', 3)).toBe(1234);
  });

  it('лишние знаки после запятой, мусор и слишком большие числа — null', () => {
    expect(parseAmount('1,005', 2)).toBeNull();
    expect(parseAmount('1,5', 0)).toBeNull();
    for (const bad of ['', '-', ',', 'abc', '1e3', '1,2,3', '--1']) expect(parseAmount(bad, 2)).toBeNull();
    expect(parseAmount('99999999999999999', 2)).toBeNull();
  });
});

describe('formatAmount', () => {
  it('разряды узким неразрывным пробелом, запятая перед дробной частью', () => {
    expect(formatAmount(150050, 2)).toBe('1\u202F500,50');
    expect(formatAmount(5, 2)).toBe('0,05');
    expect(formatAmount(-1234567, 2)).toBe('\u221212\u202F345,67');
    expect(formatAmount(1000, 0)).toBe('1\u202F000');
    expect(formatAmount(0, 2)).toBe('0,00');
  });

  it('formatAmount → parseAmount возвращает исходное значение', () => {
    for (const v of [0, 1, 99, 150050, -77, 123456789]) expect(parseAmount(formatAmount(v, 2), 2)).toBe(v);
  });
});

describe('allocate — метод наибольшего остатка', () => {
  it('части в сумме дают целое, остаток — наибольшим дробным частям, при равенстве — по порядку', () => {
    expect(allocate(100, [1, 1, 1])).toEqual([34, 33, 33]);
    expect(allocate(10, [1, 2])).toEqual([3, 7]);
    expect(allocate(2, [1, 1, 1])).toEqual([1, 1, 0]);
    expect(allocate(47512, [33, 33, 34])).toEqual([15679, 15679, 16154]);
    expect(allocate(0, [5, 7])).toEqual([0, 0]);
    expect(allocate(7, [3])).toEqual([7]);
  });

  it('программные ошибки: total не безопасное неотрицательное целое, отрицательный или дробный вес', () => {
    expect(() => allocate(-1, [1])).toThrow();
    expect(() => allocate(1.5, [1])).toThrow();
    expect(() => allocate(Number.MAX_SAFE_INTEGER + 1, [1])).toThrow();
    expect(() => allocate(Number.NaN, [1])).toThrow();
    expect(() => allocate(10, [3, -1])).toThrow();
    expect(() => allocate(10, [1, 1.5])).toThrow();
    expect(() => allocate(10, [])).toThrow();
    expect(() => allocate(10, [0, 0])).toThrow();
  });

  it('сумма частей всегда равна целому', () => {
    for (const [total, weights] of [
      [999_999_999_999, [1, 2, 3, 4, 5, 6, 7]],
      [1, [3, 3, 3]],
      [12345, [10000, 1, 1]],
    ] as const) {
      const parts = allocate(total, [...weights]);
      expect(parts.reduce((s, p) => s + p, 0)).toBe(total);
      expect(parts.every((p) => Number.isSafeInteger(p) && p >= 0)).toBe(true);
    }
  });
});
