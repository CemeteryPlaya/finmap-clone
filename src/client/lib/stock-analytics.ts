import { addDays, formatDateRu, startOfDayUtc, todayInTimezone } from '../../shared/dates';
import { formatMoney, MONEY_SCREEN } from '../../shared/money';
import type { StockItemStat, StockPrices, StockTotals } from '../../shared/schemas/stock';
import { priceAt } from '../../shared/stock-price';
import { compactMoney, linePath, niceScale, yOf } from './charts';
import type { StockGroup, StockItem } from './stock';

/** Группа таблицы «Аналитики» склада: строки товаров группы и итог по ним. */
export interface StatSection {
  key: string;
  label: string;
  rows: StockItemStat[];
  total: { soldQty: number; revenue: number; cost: number; profit: number; marginBp: number | null; lossQty: number; lossCost: number; noBatchQty: number };
}

/** Маржа итога: прибыль ÷ выручка в сотых долях процента, половина — от нуля; без выручки — null. */
function marginOf(profit: number, revenue: number): number | null {
  if (revenue === 0) return null;
  const v = (profit * 10_000) / revenue;
  return Math.sign(v) * Math.round(Math.abs(v));
}

/** Строки по группам (§8): группы — в порядке каталога, «Без группы» — последней; внутри — как пришли (по названию). */
export function statSections(rows: readonly StockItemStat[], items: readonly StockItem[], groups: readonly StockGroup[]): StatSection[] {
  const groupOf = new Map(items.map((i) => [i.id, i.groupId]));
  const order = [...groups.map((g) => ({ key: String(g.id), id: g.id as number | null, label: g.name })), { key: 'none', id: null, label: 'Без группы' }];
  return order
    .map((g) => {
      const mine = rows.filter((r) => (groupOf.get(r.itemId) ?? r.groupId) === g.id);
      const sum = (f: (r: StockItemStat) => number) => mine.reduce((a, r) => a + f(r), 0);
      const revenue = sum((r) => r.revenue);
      const profit = sum((r) => r.profit);
      return {
        key: g.key,
        label: g.label,
        rows: mine,
        total: {
          soldQty: sum((r) => r.soldQty),
          revenue,
          cost: sum((r) => r.cost),
          profit,
          marginBp: marginOf(profit, revenue),
          lossQty: sum((r) => r.lossQty),
          lossCost: sum((r) => r.lossCost),
          noBatchQty: sum((r) => r.noBatchQty),
        },
      };
    })
    .filter((s) => s.rows.length > 0);
}

/** Маржа в таблице: «82,8 %», «\u22125 %»; нет выручки — «—». */
export function marginText(bp: number | null): string {
  if (bp === null) return '—';
  const text = (Math.round(Math.abs(bp) / 10) / 10).toString().replace('.', ',');
  return `${bp < 0 && text !== '0' ? '\u2212' : ''}${text}\u00A0%`;
}

/** Строка §6.2 под итогами: «Закуплено за период X, стоимость склада изменилась на ±Y» (или «не изменилась»). */
export function totalsLine(t: StockTotals, currency: string): string {
  const money = (minor: number) => formatMoney(minor, currency, MONEY_SCREEN);
  const head = `Закуплено за период ${money(t.purchased)}, стоимость склада`;
  if (t.valueChange === 0) return `${head} не изменилась`;
  return `${head} изменилась на ${t.valueChange > 0 ? '+' : '\u2212'}${money(Math.abs(t.valueChange))}`;
}

/** Параметры запроса аналитики: период и склад; без склада — все склады. */
export function analyticsQuery(range: { from: string; to: string }, warehouse: number | null): string {
  const p = new URLSearchParams({ from: range.from, to: range.to });
  if (warehouse !== null) p.set('warehouse', String(warehouse));
  return p.toString();
}

export function analyticsExcelHref(companyId: number, warehouse: number | null, range: { from: string; to: string }): string {
  return `/api/v1/companies/${companyId}/stock/analytics/export.xlsx?${analyticsQuery(range, warehouse)}`;
}

export interface PriceChart {
  purchasePoints: { x: number; y: number; label: string }[];
  /** Ступенчатая линия цены продажи (SVG path). */
  salePath: string;
  ticks: { y: number; label: string }[];
}

/**
 * График «Динамики цен» (§8): ось X — период (начало первого дня — начало дня после последнего, по часам компании),
 * точки — цены закупки, линия — цена продажи ступенями (горизонталь до смены цены, затем вертикаль). Шкала — общая.
 */
export function priceChart(p: StockPrices, range: { from: string; to: string }, currency: string, timeZone: string, width: number, height: number): PriceChart {
  const t0 = Date.parse(startOfDayUtc(range.from, timeZone));
  const t1 = Date.parse(startOfDayUtc(addDays(range.to, 1), timeZone));
  const xOf = (ms: number) => Math.min(width, Math.max(0, ((ms - t0) / (t1 - t0)) * width));
  const changes = p.salePrices.filter((s) => s.validFrom > range.from && s.validFrom <= range.to);
  const startPrice = priceAt(p.salePrices, range.from);
  const scale = niceScale([...p.purchases.map((x) => x.unitCost), startPrice, ...changes.map((c) => c.price)]);
  const y = (v: number) => yOf(scale, v, height);

  // линия цены продажи — с той даты, когда цена появилась: до неё «0» читался бы как настоящая цена
  const known = p.salePrices.some((s) => s.validFrom <= range.from);
  const steps: { x: number; y: number }[] = known ? [{ x: 0, y: y(startPrice) }] : [];
  for (const c of changes) {
    const x = xOf(Date.parse(startOfDayUtc(c.validFrom, timeZone)));
    if (steps.length > 0) steps.push({ x, y: steps[steps.length - 1]!.y });
    steps.push({ x, y: y(c.price) });
  }
  if (steps.length > 0) steps.push({ x: width, y: steps[steps.length - 1]!.y });

  return {
    purchasePoints: p.purchases.map((x) => ({
      x: xOf(Date.parse(x.at)),
      y: y(x.unitCost),
      label: `${formatDateRu(todayInTimezone(timeZone, new Date(x.at)))} ${x.docNumber}: ${formatMoney(x.unitCost, currency, MONEY_SCREEN)}`,
    })),
    salePath: linePath(steps),
    ticks: scale.ticks.map((v) => ({ y: y(v), label: compactMoney(v, currency) })),
  };
}
