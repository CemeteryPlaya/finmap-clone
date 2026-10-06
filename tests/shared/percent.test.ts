import { describe, expect, it } from 'vitest';
import { formatBp, parsePercentToBp } from '../../src/shared/percent';

describe('проценты в сотых долях (bp)', () => {
  it('parsePercentToBp: запятая и точка, до двух знаков, знак %', () => {
    expect(parsePercentToBp('50')).toBe(5000);
    expect(parsePercentToBp('33,33')).toBe(3333);
    expect(parsePercentToBp('33.3')).toBe(3330);
    expect(parsePercentToBp(' 12,5 % ')).toBe(1250);
    expect(parsePercentToBp('0,01')).toBe(1);
    expect(parsePercentToBp('1,234')).toBeNull();
    expect(parsePercentToBp('-5')).toBeNull();
    expect(parsePercentToBp('abc')).toBeNull();
    expect(parsePercentToBp('')).toBeNull();
  });

  it('formatBp: без лишних нулей', () => {
    expect(formatBp(5000)).toBe('50');
    expect(formatBp(3333)).toBe('33,33');
    expect(formatBp(3330)).toBe('33,3');
    expect(formatBp(1)).toBe('0,01');
    expect(formatBp(10000)).toBe('100');
  });
});
