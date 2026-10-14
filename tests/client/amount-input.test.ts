import { describe, expect, it } from 'vitest';
import { sanitizeAmountInput } from '../../src/client/lib/amount-input';

describe('sanitizeAmountInput — поля сумм: цифры и один разделитель', () => {
  it('оставляет цифры и первый разделитель как введён', () => {
    expect(sanitizeAmountInput('12a3,4.5б')).toBe('123,45');
    expect(sanitizeAmountInput('12.5,3')).toBe('12.53');
    expect(sanitizeAmountInput('1,5')).toBe('1,5');
    expect(sanitizeAmountInput(',5')).toBe(',5');
  });

  it('отбрасывает пробелы, включая U+00A0 и U+202F', () => {
    expect(sanitizeAmountInput('1 500,50')).toBe('1500,50');
    expect(sanitizeAmountInput('1\u00A0500')).toBe('1500');
    expect(sanitizeAmountInput('1\u202F500')).toBe('1500');
  });

  it('выражения не вычисляются: знаки отбрасываются', () => {
    expect(sanitizeAmountInput('1500+250*2')).toBe('15002502');
    expect(sanitizeAmountInput('(1×÷2/3)')).toBe('123');
  });

  it('без negative любой минус отбрасывается', () => {
    expect(sanitizeAmountInput('-1 500')).toBe('1500');
    expect(sanitizeAmountInput('\u22121500')).toBe('1500');
  });

  it('с negative ведущий минус (в том числе U+2212) сохраняется как «-»', () => {
    expect(sanitizeAmountInput('-1 500', { negative: true })).toBe('-1500');
    expect(sanitizeAmountInput('\u22121500', { negative: true })).toBe('-1500');
    expect(sanitizeAmountInput('-', { negative: true })).toBe('-');
  });

  it('с negative минус не в начале отбрасывается', () => {
    expect(sanitizeAmountInput('5-3', { negative: true })).toBe('53');
    expect(sanitizeAmountInput('--5', { negative: true })).toBe('-5');
  });

  it('дробная часть не обрезается', () => {
    expect(sanitizeAmountInput('1,23456')).toBe('1,23456');
  });

  it('пусто остаётся пустым', () => {
    expect(sanitizeAmountInput('')).toBe('');
    expect(sanitizeAmountInput('abc')).toBe('');
  });
});
