import { bucketOf } from './guests';
import { localParts } from './hours';
import { addDays, startOfDayUtc } from '../dates';

/**
 * «Бар» (спецификация «Аналитика клуба», §8, R32–R40): окно суток остатков и движения товаров, себестоимость единицы,
 * категория, остаток, ABC, «хватит на», строки товаров и категорий, столбцы графика. Количество — ×1000, деньги — тиыны.
 */

export const ABC_A = 0.8;
export const ABC_B = 0.95;
/** «Хватит на» — по 14 последним дням с данными (§8.1) из 30 суток до конца периода (R36). */
export const RECENT_DAYS = 14;
export const RECENT_LOOKBACK = 30;
/** Меньше 3 дней — красная ячейка (§8.1). */
export const LOW_DAYS = 3;
export const NO_CATEGORY = 'Без категории';
export type Abc = 'A' | 'B' | 'C';

export interface BarWindow {
  officeId: number;
  fromAt: string;
  toAt: string;
}

/** Продажа товара; возврат — `qty` и `amount` с минусом. */
export interface BarSale {
  officeId: number;
  at: string;
  item: string;
  qty: number;
  amount: number;
}

export interface BarMove extends BarWindow {
  item: string;
  category: string;
  writeOffQty: number;
  restockSum: number;
  restockPrice: number | null;
  soldQty: number;
  soldCost: number | null;
}

export interface BarStock extends BarWindow {
  item: string;
  actualQty: number | null;
  restockPrice: number | null;
}

const ms = (iso: string) => Date.parse(iso);

/** Пересечение окна с местными сутками, мс, по суткам, которые оно задевает. */
function overlaps(w: BarWindow, tz: string): { day: string; ms: number }[] {
  const out: { day: string; ms: number }[] = [];
  const [from, to] = [ms(w.fromAt), ms(w.toAt)];
  for (let day = localParts(w.fromAt, tz).day; ms(startOfDayUtc(day, tz)) < to; day = addDays(day, 1)) {
    const lap = Math.min(to, ms(startOfDayUtc(addDays(day, 1), tz))) - Math.max(from, ms(startOfDayUtc(day, tz)));
    if (lap > 0) out.push({ day, ms: lap });
  }
  return out;
}

/** Окно лучше другого для суток: больше пересечение, при равенстве — позже начало. */
const better = (a: { ms: number; fromAt: string }, b: { ms: number; fromAt: string }) => a.ms > b.ms || (a.ms === b.ms && a.fromAt > b.fromAt);

/**
 * Окно суток (R33): ключ `${officeId}|${день}`. Окно относится к суткам наибольшего пересечения; у суток — окно
 * наибольшего пересечения, при равенстве — с более поздним `fromAt`.
 */
export function dayWindows<W extends BarWindow>(windows: readonly W[], tz: string): Map<string, W> {
  const best = new Map<string, { w: W; ms: number; fromAt: string }>();
  for (const w of windows) {
    const own = overlaps(w, tz).reduce<{ day: string; ms: number } | null>((m, x) => (m === null || x.ms > m.ms ? x : m), null);
    if (!own) continue;
    const key = `${w.officeId}|${own.day}`;
    const cand = { w, ms: own.ms, fromAt: w.fromAt };
    const cur = best.get(key);
    if (!cur || better(cand, cur)) best.set(key, cand);
  }
  return new Map([...best].map(([k, v]) => [k, v.w]));
}

/** Последнее по `toAt` значение товара, для которого `pick` не пусто. */
function latestBy<R extends BarWindow & { item: string }, V>(rows: readonly R[], pick: (r: R) => V | null): Map<string, V> {
  const out = new Map<string, { v: V; at: string }>();
  for (const r of rows) {
    const v = pick(r);
    if (v === null) continue;
    const cur = out.get(r.item);
    if (!cur || r.toAt > cur.at) out.set(r.item, { v, at: r.toAt });
  }
  return new Map([...out].map(([k, x]) => [k, x.v]));
}

/** Себестоимость единицы (R35): Σ soldCost / (Σ soldQty / 1000) окон периода; иначе последняя restockPrice до конца периода. */
export function unitCosts(periodMoves: readonly BarMove[], earlier: readonly (BarMove | BarStock)[]): Map<string, number> {
  const sums = new Map<string, { cost: number; qty: number }>();
  for (const m of periodMoves) {
    if (m.soldCost === null || m.soldQty <= 0) continue;
    const s = sums.get(m.item) ?? { cost: 0, qty: 0 };
    sums.set(m.item, { cost: s.cost + m.soldCost, qty: s.qty + m.soldQty });
  }
  const out = latestBy(earlier, (r) => r.restockPrice);
  for (const [item, s] of sums) out.set(item, (s.cost * 1000) / s.qty);
  return out;
}

/** Последняя непустая категория товара по `toAt` (R35). */
export function categoriesOf(moves: readonly BarMove[]): Map<string, string> {
  return latestBy(moves, (m) => m.category.trim() || null);
}

/** Остаток товара (R36): Σ по клубам `actualQty` из окна последних суток клуба, где товар есть. */
export function lastStock(stock: readonly BarStock[]): Map<string, number> {
  const last = new Map<string, BarStock>();
  for (const r of stock) {
    if (r.actualQty === null) continue;
    const key = `${r.officeId}|${r.item}`;
    const cur = last.get(key);
    if (!cur || r.fromAt > cur.fromAt) last.set(key, r);
  }
  const out = new Map<string, number>();
  for (const r of last.values()) out.set(r.item, (out.get(r.item) ?? 0) + r.actualQty!);
  return out;
}

const byRevenue = (a: { key: string; revenue: number }, b: { key: string; revenue: number }) => b.revenue - a.revenue || a.key.localeCompare(b.key, 'ru');

/** ABC (R37): по убыванию выручки; A — доля выручки до товара < 80 %, B — < 95 %, иначе C; выручка ≤ 0 — C. */
export function abcOf(rows: readonly { key: string; revenue: number }[]): Map<string, Abc> {
  const total = rows.reduce((t, r) => t + Math.max(0, r.revenue), 0);
  const out = new Map<string, Abc>();
  let before = 0;
  for (const r of [...rows].sort(byRevenue)) {
    const share = total > 0 ? before / total : 1;
    out.set(r.key, r.revenue <= 0 ? 'C' : share < ABC_A ? 'A' : share < ABC_B ? 'B' : 'C');
    before += Math.max(0, r.revenue);
  }
  return out;
}

/** «Хватит на», дней (R36): остаток / (продано за дни / дней); нет продаж, остатка или дней — null. */
export function daysLeft(stockQty: number | null, soldQty: number, days: number): number | null {
  if (stockQty === null || soldQty <= 0 || days <= 0) return null;
  return stockQty / (soldQty / days);
}

export interface BarRow {
  /** Товар или категория. */
  key: string;
  category: string;
  soldQty: number;
  revenue: number;
  /** null — нет цены прихода. */
  cost: number | null;
  profit: number | null;
  /** Прибыль / выручку; выручка ≤ 0 — null. */
  margin: number | null;
  writeOffQty: number;
  stockQty: number | null;
  daysLeft: number | null;
  abc: Abc;
}

export interface BarInput {
  sales: readonly BarSale[];
  /** Строки окон суток периода (`dayWindows`). */
  moves: readonly BarMove[];
  costs: ReadonlyMap<string, number>;
  categories: ReadonlyMap<string, string>;
  stock: ReadonlyMap<string, number>;
  recent: { sold: ReadonlyMap<string, number>; days: number };
}

const marginOf = (profit: number | null, revenue: number) => (profit === null || revenue <= 0 ? null : profit / revenue);

/** Строки по убыванию выручки с ABC. */
const ranked = (rows: Omit<BarRow, 'abc'>[]): BarRow[] => {
  const abc = abcOf(rows);
  return rows.sort(byRevenue).map((r) => ({ ...r, abc: abc.get(r.key)! }));
};

/** Строки товаров: товары продаж и движения периода; по убыванию выручки, равные — `localeCompare('ru')`. */
export function barItems(input: BarInput): BarRow[] {
  const acc = new Map<string, { soldQty: number; revenue: number; writeOffQty: number }>();
  const of = (item: string) => acc.get(item) ?? acc.set(item, { soldQty: 0, revenue: 0, writeOffQty: 0 }).get(item)!;
  for (const s of input.sales) {
    const a = of(s.item);
    a.soldQty += s.qty;
    a.revenue += s.amount;
  }
  for (const m of input.moves) of(m.item).writeOffQty += m.writeOffQty;
  return ranked(
    [...acc].map(([item, a]) => {
      const unit = input.costs.get(item);
      const cost = unit === undefined ? null : Math.round((a.soldQty * unit) / 1000);
      const profit = cost === null ? null : a.revenue - cost;
      const stockQty = input.stock.get(item) ?? null;
      return {
        key: item,
        category: input.categories.get(item) ?? NO_CATEGORY,
        ...a,
        cost,
        profit,
        margin: marginOf(profit, a.revenue),
        stockQty,
        daysLeft: daysLeft(stockQty, input.recent.sold.get(item) ?? 0, input.recent.days),
      };
    }),
  );
}

/** Строки категорий (R38): суммы товаров; себестоимость и маржа — по товарам с себестоимостью; без остатка. */
export function barCategories(items: readonly BarRow[]): BarRow[] {
  const acc = new Map<string, { soldQty: number; revenue: number; writeOffQty: number; cost: number | null; profit: number | null; costed: number }>();
  for (const r of items) {
    const a = acc.get(r.category) ?? { soldQty: 0, revenue: 0, writeOffQty: 0, cost: null, profit: null, costed: 0 };
    a.soldQty += r.soldQty;
    a.revenue += r.revenue;
    a.writeOffQty += r.writeOffQty;
    if (r.cost !== null) {
      a.cost = (a.cost ?? 0) + r.cost;
      a.profit = (a.profit ?? 0) + r.profit!;
      a.costed += r.revenue;
    }
    acc.set(r.category, a);
  }
  return ranked(
    [...acc].map(([category, { costed, ...a }]) => ({ key: category, category, ...a, margin: marginOf(a.profit, costed), stockQty: null, daysLeft: null })),
  );
}

/** Столбцы графика (R39) по корзинам шага: себестоимость, прибыль и выручка товаров без цены прихода. */
export function barColumns(sales: readonly BarSale[], costs: ReadonlyMap<string, number>, buckets: readonly { from: string; to: string }[], tz: string): { cost: number; profit: number; noCost: number }[] {
  const acc = buckets.map(() => ({ cost: 0, costed: 0, noCost: 0 }));
  for (const s of sales) {
    const i = bucketOf(localParts(s.at, tz).day, buckets);
    if (i < 0) continue;
    const unit = costs.get(s.item);
    if (unit === undefined) acc[i]!.noCost += s.amount;
    else {
      acc[i]!.cost += (s.qty * unit) / 1000;
      acc[i]!.costed += s.amount;
    }
  }
  return acc.map((a) => {
    const cost = Math.round(a.cost);
    return { cost, profit: a.costed - cost, noCost: a.noCost };
  });
}
