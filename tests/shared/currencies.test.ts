import { describe, expect, it } from 'vitest';
import { CURRENCIES, getCurrency } from '../../src/shared/currencies';

describe('справочник валют', () => {
  it('содержит KZT с 2 знаками и символом ₸', () => {
    expect(getCurrency('KZT')).toEqual({ code: 'KZT', name: 'Казахстанский тенге', symbol: '₸', minorUnits: 2 });
  });
  it('знает валюты с 0 и 3 знаками', () => {
    expect(getCurrency('JPY').minorUnits).toBe(0);
    expect(getCurrency('KWD').minorUnits).toBe(3);
  });
  it('коды уникальны и в верхнем регистре', () => {
    const codes = CURRENCIES.map((c) => c.code);
    expect(new Set(codes).size).toBe(codes.length);
    expect(codes.every((c) => /^[A-Z]{3}$/.test(c))).toBe(true);
  });
  it('бросает ошибку на неизвестный код', () => {
    expect(() => getCurrency('XXX')).toThrow(/XXX/);
  });
});
