import { describe, expect, it } from 'vitest';
import { parseIntInput } from '../../src/client/lib/numbers';

describe('parseIntInput', () => {
  it('целые числа, пробелы между разрядами игнорируются', () => {
    expect(parseIntInput('30')).toEqual({ ok: true, value: 30 });
    expect(parseIntInput(' 1 000 ')).toEqual({ ok: true, value: 1000 });
    expect(parseIntInput('-5')).toEqual({ ok: true, value: -5 });
  });

  it('«1e3», дроби и мусор — ошибка по-русски', () => {
    for (const bad of ['1e3', '1.5', '1,5', '12abc', '', '0x10']) {
      expect(parseIntInput(bad)).toEqual({ ok: false, error: 'Введите целое число' });
    }
    expect(parseIntInput('99999999999999999999')).toEqual({ ok: false, error: 'Слишком большое число' });
  });
});
