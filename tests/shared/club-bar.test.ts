import { describe, expect, it } from 'vitest';
import {
  abcOf,
  barCategories,
  barColumns,
  barItems,
  categoriesOf,
  dayWindows,
  daysLeft,
  lastStock,
  NO_CATEGORY,
  unitCosts,
  type BarInput,
  type BarMove,
  type BarSale,
  type BarStock,
} from '../../src/shared/club-analytics/bar';

const TZ = 'Asia/Almaty';
const w = (officeId: number, fromAt: string, toAt: string) => ({ officeId, fromAt: `2026-${fromAt}:00.000Z`, toAt: `2026-${toAt}:00.000Z` });
const A = w(1, '10-31T19:00', '11-01T19:00');
const B = w(1, '11-01T03:05', '11-02T03:05');
const C = w(1, '11-01T19:00', '11-02T19:00');

const move = (item: string, o: Partial<BarMove> = {}): BarMove => ({ ...A, item, category: 'Напитки', writeOffQty: 0, restockSum: 0, restockPrice: null, soldQty: 0, soldCost: null, ...o });
const stockRow = (item: string, o: Partial<BarStock> = {}): BarStock => ({ ...A, item, actualQty: null, restockPrice: null, ...o });
const sale = (item: string, at: string, qty: number, amount: number, officeId = 1): BarSale => ({ officeId, at: `2026-${at}:00.000Z`, item, qty, amount });

describe('dayWindows (R33)', () => {
  it('старые перекрытые окна: у суток — окно наибольшего пересечения, старое окно не удваивает', () => {
    const got = dayWindows([A, B, C], TZ);
    expect(got.get('1|2026-11-01')).toBe(A);
    expect(got.get('1|2026-11-02')).toBe(C);
    expect([...got.values()]).not.toContain(B);
    expect(got.size).toBe(2);
  });

  it('только старое окно — сутки наибольшего пересечения', () => {
    const got = dayWindows([B], TZ);
    expect(got.get('1|2026-11-01')).toBe(B);
    expect(got.has('1|2026-11-02')).toBe(false);
  });

  it('частичное окно текущих суток', () => {
    const part = w(1, '11-01T19:00', '11-02T07:00');
    expect(dayWindows([part], TZ).get('1|2026-11-02')).toBe(part);
  });

  it('равное пересечение — окно с более поздним началом', () => {
    const early = w(1, '10-31T19:00', '11-01T07:00');
    const late = w(1, '11-01T07:00', '11-01T19:00');
    expect(dayWindows([early, late], TZ).get('1|2026-11-01')).toBe(late);
  });

  it('два клуба — окна выбираются у каждого отдельно', () => {
    const other = { ...A, officeId: 2 };
    const got = dayWindows([A, other], TZ);
    expect(got.get('1|2026-11-01')).toBe(A);
    expect(got.get('2|2026-11-01')).toBe(other);
  });
});

describe('unitCosts, categoriesOf, lastStock (R35, R36)', () => {
  it('себестоимость единицы — Σ себестоимости проданного / Σ продано', () => {
    const got = unitCosts([move('Кола', { soldQty: 2000, soldCost: 76_000 }), move('Кола', { ...C, soldQty: 1000, soldCost: 38_000 })], []);
    expect(got.get('Кола')).toBe(38_000);
  });

  it('без продаж в окнах — последняя цена прихода до конца периода; нет её — товара нет', () => {
    const earlier = [move('Кола', { restockPrice: 30_000 }), stockRow('Кола', { ...C, restockPrice: 40_000 }), stockRow('Кола', { ...B, restockPrice: null })];
    expect(unitCosts([move('Кола', { ...C })], earlier).get('Кола')).toBe(40_000);
    expect(unitCosts([move('Вода')], []).has('Вода')).toBe(false);
  });

  it('пустая себестоимость проданного не считается', () => {
    const got = unitCosts([move('Кола', { soldQty: 1000, soldCost: null }), move('Кола', { ...C, soldQty: 1000, soldCost: 50_000 })], []);
    expect(got.get('Кола')).toBe(50_000);
  });

  it('категория — последняя непустая', () => {
    const got = categoriesOf([move('Кола', { category: 'Еда' }), move('Кола', { ...C, category: 'Напитки' }), move('Кола', { ...B, category: '' })]);
    expect(got.get('Кола')).toBe('Напитки');
  });

  it('остаток — из окна последних суток клуба, где товар есть; по клубам — сумма', () => {
    const got = lastStock([
      stockRow('Кола', { actualQty: 20_000 }),
      stockRow('Кола', { ...C, actualQty: 10_000 }),
      stockRow('Вода', { actualQty: 7_000 }),
      stockRow('Кола', { ...A, officeId: 2, actualQty: 5_000 }),
    ]);
    expect(got.get('Кола')).toBe(15_000);
    expect(got.get('Вода')).toBe(7_000);
  });
});

describe('abcOf (R37)', () => {
  it('граница 80 %: у товара, до которого ровно 80 %, — B', () => {
    const got = abcOf([
      { key: 'd', revenue: 5 },
      { key: 'b', revenue: 30 },
      { key: 'a', revenue: 50 },
      { key: 'c', revenue: 15 },
    ]);
    expect(['a', 'b', 'c', 'd'].map((k) => got.get(k))).toEqual(['A', 'A', 'B', 'C']);
  });

  it('нулевая и отрицательная выручка — C; все нули — все C', () => {
    const got = abcOf([
      { key: 'a', revenue: 100 },
      { key: 'z', revenue: 0 },
      { key: 'r', revenue: -10 },
    ]);
    expect([got.get('a'), got.get('z'), got.get('r')]).toEqual(['A', 'C', 'C']);
    expect([...abcOf([{ key: 'x', revenue: 0 }]).values()]).toEqual(['C']);
  });
});

describe('daysLeft (R36)', () => {
  it('остаток / средние продажи в день', () => {
    expect(daysLeft(10_000, 14_000, 14)).toBe(10);
    expect(daysLeft(5_000, 5_000, 3)).toBe(3);
    expect(daysLeft(1_000, 7_000, 14)).toBeCloseTo(2);
  });

  it('без продаж, остатка или дней — null', () => {
    expect(daysLeft(10_000, 0, 14)).toBeNull();
    expect(daysLeft(null, 5_000, 14)).toBeNull();
    expect(daysLeft(10_000, 5_000, 0)).toBeNull();
  });
});

const input = (o: Partial<BarInput>): BarInput => ({ sales: [], moves: [], costs: new Map(), categories: new Map(), stock: new Map(), recent: { sold: new Map(), days: 0 }, ...o });

describe('barItems', () => {
  it('продажа и возврат, себестоимость, маржа, «хватит на»', () => {
    const [row] = barItems(
      input({
        sales: [sale('Кола', '11-01T07:00', 2000, 150_000), sale('Кола', '11-01T08:00', -1000, -75_000)],
        costs: new Map([['Кола', 38_000]]),
        categories: new Map([['Кола', 'Напитки']]),
        stock: new Map([['Кола', 10_000]]),
        recent: { sold: new Map([['Кола', 14_000]]), days: 14 },
      }),
    );
    expect(row).toMatchObject({ key: 'Кола', category: 'Напитки', soldQty: 1000, revenue: 75_000, cost: 38_000, profit: 37_000, stockQty: 10_000, daysLeft: 10, abc: 'A' });
    expect(row!.margin).toBeCloseTo(37_000 / 75_000);
  });

  it('только возврат: выручка ≤ 0, класс C, маржа «—» (Review Focus 2)', () => {
    const rows = barItems(input({ sales: [sale('Кола', '11-01T07:00', 3000, 225_000), sale('Вода', '11-01T08:00', -1000, -75_000)], costs: new Map([['Вода', 30_000]]) }));
    const back = rows.find((r) => r.key === 'Вода')!;
    expect(back).toMatchObject({ revenue: -75_000, abc: 'C', margin: null });
  });

  it('без себестоимости — себестоимость, прибыль и маржа пустые; без категории — «Без категории»', () => {
    const [row] = barItems(input({ sales: [sale('Новый', '11-01T07:00', 1000, 50_000)] }));
    expect(row).toMatchObject({ category: NO_CATEGORY, cost: null, profit: null, margin: null, stockQty: null, daysLeft: null });
  });

  it('товар без продаж, но со списанием — строка с нулём продаж', () => {
    const rows = barItems(input({ sales: [sale('Кола', '11-01T07:00', 1000, 75_000)], moves: [move('Чипсы', { writeOffQty: 2000, category: 'Еда' })], categories: new Map([['Чипсы', 'Еда']]) }));
    expect(rows.map((r) => r.key)).toEqual(['Кола', 'Чипсы']);
    expect(rows[1]).toMatchObject({ soldQty: 0, revenue: 0, writeOffQty: 2000, category: 'Еда' });
  });
});

describe('barCategories (R38)', () => {
  it('суммы товаров; себестоимость и маржа — по товарам с ней; остатка нет', () => {
    const items = barItems(
      input({
        sales: [sale('Кола', '11-01T07:00', 1000, 100_000), sale('Вода', '11-01T07:00', 1000, 50_000), sale('Чипсы', '11-01T07:00', 1000, 10_000)],
        costs: new Map([['Кола', 60_000]]),
        categories: new Map([
          ['Кола', 'Напитки'],
          ['Вода', 'Напитки'],
          ['Чипсы', 'Еда'],
        ]),
        stock: new Map([['Кола', 5_000]]),
      }),
    );
    const [drinks, food] = barCategories(items);
    expect(drinks).toMatchObject({ key: 'Напитки', soldQty: 2000, revenue: 150_000, cost: 60_000, profit: 40_000, stockQty: null, daysLeft: null, abc: 'A' });
    expect(drinks!.margin).toBeCloseTo(0.4);
    expect(food).toMatchObject({ key: 'Еда', cost: null, profit: null, margin: null, abc: 'B' }); // до неё 93,75 % выручки
  });
});

describe('barColumns (R39)', () => {
  it('себестоимость, прибыль и выручка без себестоимости по корзинам; в сумме — выручка бара колонки', () => {
    const sales = [sale('Кола', '11-01T07:00', 2000, 150_000), sale('Сэндвич', '11-01T08:00', 1000, 90_000), sale('Кола', '11-02T07:00', 1000, 75_000)];
    const got = barColumns(sales, new Map([['Кола', 38_000]]), [
      { from: '2026-11-01', to: '2026-11-01' },
      { from: '2026-11-02', to: '2026-11-02' },
    ], TZ);
    expect(got).toEqual([
      { cost: 76_000, profit: 74_000, noCost: 90_000 },
      { cost: 38_000, profit: 37_000, noCost: 0 },
    ]);
  });
});
