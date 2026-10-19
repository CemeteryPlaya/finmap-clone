import { describe, expect, it } from 'vitest';
import type { StockGroup, StockItem } from '../../src/client/lib/stock';
import { analyticsExcelHref, analyticsQuery, marginText, priceChart, statSections, totalsLine } from '../../src/client/lib/stock-analytics';
import { STOCK_TABS } from '../../src/client/lib/stock-view';
import type { StockItemStat, StockPrices, StockTotals } from '../../src/shared/schemas/stock';

const group = (id: number, name: string): StockGroup => ({ id, companyId: 1, name, orderIndex: id, createdAt: 'x', archivedAt: null });
const item = (id: number, name: string, groupId: number | null): StockItem =>
  ({ id, companyId: 1, name, groupId, unit: 'pcs', barcode: null, isCombo: false, salePrice: 0, minQty: null, createdAt: 'x', archivedAt: null, prices: [], parts: [], hasDocs: true }) as StockItem;
const stat = (itemId: number, groupId: number | null, over: Partial<StockItemStat> = {}): StockItemStat => ({
  itemId,
  groupId,
  isCombo: false,
  soldQty: 1000,
  revenue: 1000,
  cost: 400,
  profit: 600,
  marginBp: 6000,
  lossQty: 0,
  lossCost: 0,
  avgSalePrice: 1000,
  avgPurchasePrice: 400,
  noBatchQty: 0,
  ...over,
});

describe('«Аналитика» склада: строки по группам (§8, Склад-3)', () => {
  it('группы в порядке каталога, «Без группы» последней; итог группы и маржа итога', () => {
    const groups = [group(1, 'Напитки'), group(2, 'Снеки')];
    const items = [item(10, 'Кола 0,5', 1), item(11, 'Сок', 1), item(12, 'Чипсы', 2), item(13, 'Жвачка', null)];
    const sections = statSections([stat(13, null), stat(12, 2), stat(10, 1, { revenue: 3000, cost: 1000, profit: 2000 }), stat(11, 1, { revenue: 1000, cost: 1500, profit: -500, marginBp: -5000 })], items, groups);
    expect(sections.map((s) => [s.label, s.rows.map((r) => r.itemId)])).toEqual([
      ['Напитки', [10, 11]],
      ['Снеки', [12]],
      ['Без группы', [13]],
    ]);
    expect(sections[0]!.total).toMatchObject({ revenue: 4000, cost: 2500, profit: 1500, marginBp: 3750 });
    // группа без продаж: маржа — «—»
    expect(statSections([stat(12, 2, { revenue: 0, cost: 0, profit: 0, marginBp: null })], items, groups)[0]!.total.marginBp).toBeNull();
  });

  it('строка итогов §6.2: «Закуплено за период X, стоимость склада изменилась на ±Y»', () => {
    const t = (valueChange: number): StockTotals => ({ revenue: 0, cost: 0, profit: 0, losses: 0, surplus: 0, purchased: 210_000, valueStart: 0, valueEnd: valueChange, valueChange });
    expect(totalsLine(t(59_000), 'KZT')).toBe('Закуплено за период 2 100 ₸, стоимость склада изменилась на +590 ₸');
    expect(totalsLine(t(-5000), 'KZT')).toBe('Закуплено за период 2 100 ₸, стоимость склада изменилась на −50 ₸');
    expect(totalsLine(t(0), 'KZT')).toBe('Закуплено за период 2 100 ₸, стоимость склада не изменилась');
  });

  it('маржа текстом: десятые доли процента, минус — U+2212, без выручки — «—»', () => {
    expect([marginText(8278), marginText(-500), marginText(0), marginText(null), marginText(-4)]).toEqual(['82,8 %', '−5 %', '0 %', '—', '0 %']);
  });

  it('адреса: запрос API и Excel со складом и периодом; «Все склады» — без склада', () => {
    const range = { from: '2026-07-01', to: '2026-09-30' };
    expect(analyticsQuery(range, 5)).toBe('from=2026-07-01&to=2026-09-30&warehouse=5');
    expect(analyticsQuery(range, null)).toBe('from=2026-07-01&to=2026-09-30');
    expect(analyticsExcelHref(7, null, range)).toBe('/api/v1/companies/7/stock/analytics/export.xlsx?from=2026-07-01&to=2026-09-30');
  });

  it('вкладки «Склада» — четыре, «Аналитика» последней', () => {
    expect(STOCK_TABS.map((t) => t.label)).toEqual(['Остатки', 'Документы', 'Товары', 'Аналитика']);
  });
});

describe('«Динамика цен»: график (§8)', () => {
  const prices: StockPrices = {
    purchases: [
      { at: '2026-07-05T06:00:00.000Z', docId: 1, docNumber: 'П-0001', unitCost: 10_000 },
      { at: '2026-08-05T06:00:00.000Z', docId: 2, docNumber: 'П-0002', unitCost: 12_000 },
    ],
    salePrices: [
      { validFrom: '2026-06-01', price: 50_000 },
      { validFrom: '2026-08-10', price: 60_000 },
    ],
    margins: [],
    hint: null,
  };
  const range = { from: '2026-07-01', to: '2026-09-30' };

  it('точки закупки в области графика, по времени слева направо', () => {
    const c = priceChart(prices, range, 'KZT', 'Asia/Almaty', 600, 200);
    expect(c.purchasePoints).toHaveLength(2);
    expect(c.purchasePoints[0]!.x).toBeLessThan(c.purchasePoints[1]!.x);
    for (const p of c.purchasePoints) {
      expect(p.x).toBeGreaterThanOrEqual(0);
      expect(p.x).toBeLessThanOrEqual(600);
      expect(p.y).toBeGreaterThanOrEqual(0);
      expect(p.y).toBeLessThanOrEqual(200);
    }
    expect(c.purchasePoints[1]!.label).toBe('05.08.2026 П-0002: 120 ₸');
  });

  it('цена продажи — ступенями: горизонталь до смены цены, затем вертикаль; начало — цена на начало периода', () => {
    const c = priceChart(prices, range, 'KZT', 'Asia/Almaty', 600, 200);
    const nums = c.salePath.match(/-?\d+(\.\d+)?/g)!.map(Number);
    // M x0 y0 L x1 y0 L x1 y1 L 600 y1
    expect(c.salePath.startsWith('M0.0 ')).toBe(true);
    expect(nums[1]).toBe(nums[3]);
    expect(nums[2]).toBe(nums[4]);
    expect(nums[5]).toBeLessThan(nums[3]!);
    expect(nums[6]).toBe(600);
    expect(c.ticks.length).toBeGreaterThan(1);
    expect(c.ticks.every((t) => t.label !== '')).toBe(true);
  });

  it('без истории цены и закупок — пустой график без ошибок', () => {
    const c = priceChart({ purchases: [], salePrices: [], margins: [], hint: null }, range, 'KZT', 'Asia/Almaty', 600, 200);
    expect(c.purchasePoints).toEqual([]);
    expect(c.salePath).toBe('');
  });

  it('цена появилась внутри периода — линия начинается с её даты, а не с нуля в начале', () => {
    const c = priceChart({ ...prices, salePrices: [{ validFrom: '2026-08-10', price: 60_000 }] }, range, 'KZT', 'Asia/Almaty', 600, 200);
    const nums = c.salePath.match(/-?\d+(\.\d+)?/g)!.map(Number);
    expect(c.salePath.startsWith('M0.0')).toBe(false);
    expect(nums[0]).toBeGreaterThan(0);
    expect(nums.at(-2)).toBe(600);
  });
});
