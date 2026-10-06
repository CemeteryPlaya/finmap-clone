import { describe, expect, it } from 'vitest';
import { convertMinor, DEC_ONE, decToString, divDec, parseDecimal, roundSignificant } from '../../src/shared/decimal';

const dec = (s: string) => parseDecimal(s)!;

describe('decimal', () => {
  it('parseDecimal: запятая и точка, до 10 знаков после запятой; мусор и отрицательные — null', () => {
    expect(parseDecimal('475,12')).toBe(47512n * 10n ** 18n);
    expect(parseDecimal(' 1.5 ')).toBe(15n * 10n ** 19n);
    expect(parseDecimal('0')).toBe(0n);
    expect(parseDecimal('1.0123456789')).toBe(10123456789n * 10n ** 10n);
    expect(parseDecimal('1.01234567891')).toBeNull();
    for (const bad of ['', 'abc', '-1', '1e3', '1,2,3', '.5']) expect(parseDecimal(bad)).toBeNull();
  });

  it('decToString без лишних нулей', () => {
    expect(decToString(dec('475.1200'))).toBe('475.12');
    expect(decToString(DEC_ONE)).toBe('1');
    expect(decToString(0n)).toBe('0');
  });

  it('divDec: 20 знаков, half-up на последнем', () => {
    expect(decToString(divDec(DEC_ONE, dec('3')))).toBe('0.33333333333333333333');
    expect(decToString(divDec(dec('2'), dec('3')))).toBe('0.66666666666666666667');
    expect(decToString(divDec(dec('520'), dec('475')))).toBe('1.09473684210526315789');
  });

  it('roundSignificant: 10 значащих цифр, half-up', () => {
    expect(roundSignificant(divDec(DEC_ONE, dec('475')))).toBe('0.002105263158');
    expect(roundSignificant(divDec(dec('520'), dec('475')))).toBe('1.094736842');
    expect(roundSignificant(dec('475.12'))).toBe('475.12');
    expect(roundSignificant(dec('9999999999.5'))).toBe('10000000000');
  });

  it('convertMinor: валюты с 0, 2 и 3 знаками, half-up от нуля, знак сохраняется', () => {
    expect(convertMinor(10000, dec('475.12'), 2, 2)).toBe(4751200); // 100.00 USD → 47 512.00 KZT
    expect(convertMinor(1000, dec('3.2'), 0, 2)).toBe(320000); // 1000 JPY → 3 200.00 KZT
    expect(convertMinor(1500, dec('1550.5'), 3, 2)).toBe(232575); // 1.500 KWD → 2 325.75 KZT
    expect(convertMinor(1, dec('0.5'), 2, 2)).toBe(1); // 0.005 → 0.01
    expect(convertMinor(1, dec('0.49'), 2, 2)).toBe(0);
    expect(convertMinor(-1, dec('0.5'), 2, 2)).toBe(-1);
    expect(convertMinor(4751200, divDec(DEC_ONE, dec('475.12')), 2, 2)).toBe(10000);
    expect(convertMinor(123, DEC_ONE, 2, 2)).toBe(123);
  });
});
