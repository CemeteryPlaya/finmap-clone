import { describe, expect, it } from 'vitest';
import { daysLeftText, noCostText, qtyText, sortBar, type BarRowView } from '../../src/client/lib/club-bar';

/** «Бар» на клиенте (спецификация «Аналитика клуба», §8, R36–R39; план АК-4, задача 5). */
const row = (key: string, o: Partial<BarRowView> = {}): BarRowView => ({
  key,
  category: 'Напитки',
  soldQty: 1000,
  revenue: 100,
  cost: null,
  profit: null,
  margin: null,
  writeOffQty: 0,
  stockQty: null,
  daysLeft: null,
  abc: 'C',
  ...o,
});

describe('«Бар» — таблица', () => {
  it('сортировка по марже: пустые — в конце при любом направлении', () => {
    const rows = [row('a', { margin: 0.2 }), row('b'), row('c', { margin: 0.5 })];
    expect(sortBar(rows, 'margin', 'asc').map((r) => r.key)).toEqual(['a', 'c', 'b']);
    expect(sortBar(rows, 'margin', 'desc').map((r) => r.key)).toEqual(['c', 'a', 'b']);
  });

  it('сортировка по названию — localeCompare', () => {
    expect(sortBar([row('Вода'), row('Айран')], 'key', 'asc').map((r) => r.key)).toEqual(['Айран', 'Вода']);
  });

  it('«хватит на»: нет — «—»; до одного знака; целое — без запятой', () => {
    expect(daysLeftText(null)).toBe('—');
    expect(daysLeftText(2.46)).toBe('2,5');
    expect(daysLeftText(10)).toBe('10');
  });

  it('«без себестоимости: N товаров» — со склонением; нет таких — null', () => {
    expect(noCostText(0)).toBeNull();
    expect(noCostText(1)).toBe('без себестоимости: 1 товар');
    expect(noCostText(2)).toBe('без себестоимости: 2 товара');
    expect(noCostText(5)).toBe('без себестоимости: 5 товаров');
  });

  it('количество ×1000 — до 3 знаков без лишних нулей', () => {
    expect(qtyText(1500)).toBe('1,5');
    expect(qtyText(3000)).toBe('3');
    expect(qtyText(125)).toBe('0,125');
  });
});
