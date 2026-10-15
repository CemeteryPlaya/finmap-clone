import { describe, expect, it } from 'vitest';
import { priceAt } from '../../src/shared/stock-price';

describe('priceAt', () => {
  const history = [
    { price: 500, validFrom: '2026-09-01' },
    { price: 700, validFrom: '2026-10-01' },
    { price: 600, validFrom: '2026-09-15' },
  ];

  it('последняя строка с validFrom не позже даты, порядок строк не важен', () => {
    expect(priceAt(history, '2026-09-01')).toBe(500);
    expect(priceAt(history, '2026-09-14')).toBe(500);
    expect(priceAt(history, '2026-09-15')).toBe(600);
    expect(priceAt(history, '2026-09-30')).toBe(600);
    expect(priceAt(history, '2026-10-01')).toBe(700);
    expect(priceAt(history, '2027-01-01')).toBe(700);
  });

  it('до первой строки и без истории — 0', () => {
    expect(priceAt(history, '2026-08-31')).toBe(0);
    expect(priceAt([], '2026-10-01')).toBe(0);
  });
});
