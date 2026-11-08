import { and, asc, eq, gte, inArray, isNotNull, lt } from 'drizzle-orm';
import {
  barCategories,
  barColumns,
  barItems,
  categoriesOf,
  dayWindows,
  lastStock,
  RECENT_DAYS,
  RECENT_LOOKBACK,
  unitCosts,
  type BarMove,
  type BarRow,
  type BarSale,
  type BarStock,
  type BarWindow,
} from '../../../shared/club-analytics/bar';
import { periodDays, previousRange } from '../../../shared/club-analytics/columns';
import { combineCoverage, dayCoverage, type DayCoverage } from '../../../shared/club-analytics/coverage';
import { localParts } from '../../../shared/club-analytics/hours';
import { addDays } from '../../../shared/dates';
import { reportColumns, type ReportColumn, type ReportStep } from '../../../shared/report-engine';
import type { BarQuery, BarRowsQuery } from '../../../shared/schemas/club-analytics';
import type { Db } from '../../db/client';
import { senetBarPurchases, senetCashMoves, senetGoodsMoves, senetShifts, senetSoldItems, senetStock } from '../../db/schema';
import { exportFileName } from '../../http/export-name';
import { buildXlsx, type XlsxCell, type XlsxSheet } from '../../http/xlsx';
import { requireCompany } from '../companies/guard';
import { minorToDecimal } from '../operations/journal-export';
import { reportInfo } from '../analytics/report-export';
import { loadSpans } from '../senet/store';
import type { ReportKind } from '../senet/source';
import { bounds, coverageSummary } from './load';
import type { CellItem } from './revenue';
import { clubScope } from './scope';

/** Данные бара периода (§8, R33–R36): продажи, строки окон суток, себестоимость единицы, категории, остаток, покрытие. */
export interface ClubBarData {
  days: string[];
  /** Покрытие дней (R41): продажи и движение товаров. */
  cov: DayCoverage[];
  sales: BarSale[];
  moves: BarMove[];
  costs: Map<string, number>;
  categories: Map<string, string>;
  stock: Map<string, number>;
  recent: { sold: Map<string, number>; days: number };
  /** Закуплено из кассы (§8.2): Σ разобранных закупок выемок «Бар». */
  desk: number;
}

const DAY_MS = 86_400_000;
const PAGE = 50;
const REPORTS: ReportKind[] = ['soldItems', 'goodsMoves'];
const BY_LABEL = { items: 'Товары', categories: 'Категории' } as const;

const sum = (xs: readonly number[]) => xs.reduce((t, x) => t + x, 0);
const minusDays = (iso: string, days: number) => new Date(Date.parse(iso) - days * DAY_MS).toISOString();

/** Продажи товаров клубов `[start, end)`: строки с количеством; возврат — с минусом (как «Бар» в «Выручке»). */
async function salesOf(db: Db, ids: number[], start: string, end: string): Promise<BarSale[]> {
  if (!ids.length) return [];
  const rows = await db
    .select({ officeId: senetSoldItems.officeId, at: senetSoldItems.at, item: senetSoldItems.item, qty: senetSoldItems.qty, amount: senetSoldItems.amount, refund: senetSoldItems.refund })
    .from(senetSoldItems)
    .where(and(inArray(senetSoldItems.officeId, ids), gte(senetSoldItems.at, start), lt(senetSoldItems.at, end), isNotNull(senetSoldItems.qty)))
    .orderBy(asc(senetSoldItems.at), asc(senetSoldItems.id));
  return rows.map((r) => ({ officeId: r.officeId, at: r.at, item: r.item, qty: r.refund ? -r.qty! : r.qty!, amount: r.refund ? -r.amount : r.amount }));
}

/** Строки окон, выбранных для суток `days` (R33). */
export function rowsOfDays<R extends BarWindow>(rows: readonly R[], days: ReadonlySet<string>, tz: string): R[] {
  const windows = [...new Map(rows.map((r) => [`${r.officeId}|${r.fromAt}`, r])).values()];
  const chosen = new Set<string>();
  for (const [key, w] of dayWindows(windows, tz)) if (days.has(key.slice(key.indexOf('|') + 1))) chosen.add(`${w.officeId}|${w.fromAt}`);
  return rows.filter((r) => chosen.has(`${r.officeId}|${r.fromAt}`));
}

/** Продано для «хватит на» (R36): последние 14 дней с полными продажами из 30 суток до `min(конец, сегодня)`. */
export function recentSold(sales: readonly BarSale[], days: readonly string[], cov: readonly DayCoverage[], tz: string) {
  const full = new Set(days.filter((_, i) => cov[i] === 'full').slice(-RECENT_DAYS));
  const sold = new Map<string, number>();
  for (const s of sales) if (full.has(localParts(s.at, tz).day)) sold.set(s.item, (sold.get(s.item) ?? 0) + s.qty);
  return { sold, days: full.size };
}

/** Покрытие дней отчётами клубов: у «Все клубы» день полон, только если полон у каждого клуба (R1). */
async function coverage(db: Db, ids: number[], reports: ReportKind[], days: readonly string[], tz: string): Promise<DayCoverage[]> {
  if (!ids.length) return days.map(() => 'none');
  const { start, end } = bounds(days[0]!, days.at(-1)!, tz);
  const spans = await loadSpans(db, ids, reports, start, end);
  return combineCoverage(ids.flatMap((id) => reports.map((r) => dayCoverage(spans.get(id)!.get(r)!, days, tz))));
}

/** Закуплено из кассы (§8.2): закупки выемок смен клубов с временем в `[start, end)`. */
async function deskOf(db: Db, ids: number[], start: string, end: string): Promise<number> {
  const rows = await db
    .select({ amount: senetBarPurchases.amount })
    .from(senetBarPurchases)
    .innerJoin(senetCashMoves, eq(senetCashMoves.id, senetBarPurchases.cashMoveId))
    .innerJoin(senetShifts, eq(senetShifts.id, senetCashMoves.shiftId))
    .where(and(inArray(senetShifts.officeId, ids), gte(senetCashMoves.at, start), lt(senetCashMoves.at, end)));
  return sum(rows.map((r) => r.amount));
}

const empty = (days: string[]): ClubBarData => ({ days, cov: days.map(() => 'none'), sales: [], moves: [], costs: new Map(), categories: new Map(), stock: new Map(), recent: { sold: new Map(), days: 0 }, desk: 0 });

/** Бар клубов `ids` за `from`–`to` (§8, R33–R36); `today` — местная дата: «хватит на» не заглядывает в будущее. */
export async function clubBar(db: Db, tz: string, ids: number[], from: string, to: string, today: string): Promise<ClubBarData> {
  const days = periodDays(from, to);
  if (!ids.length) return empty(days);
  const { start, end } = bounds(from, to, tz);
  const recentDays = periodDays(addDays(to < today ? to : today, 1 - RECENT_LOOKBACK), to < today ? to : today);
  const recentStart = bounds(recentDays[0]!, recentDays.at(-1)!, tz);
  const salesStart = recentStart.start < start ? recentStart.start : start;
  const [allSales, moves, stockRows, cov, recentCov, desk] = await Promise.all([
    salesOf(db, ids, salesStart, end > recentStart.end ? end : recentStart.end),
    db
      .select()
      .from(senetGoodsMoves)
      .where(and(inArray(senetGoodsMoves.officeId, ids), lt(senetGoodsMoves.fromAt, end))),
    db
      .select()
      .from(senetStock)
      .where(and(inArray(senetStock.officeId, ids), gte(senetStock.toAt, minusDays(start, RECENT_LOOKBACK + 1)), lt(senetStock.fromAt, end))),
    coverage(db, ids, REPORTS, days, tz),
    coverage(db, ids, ['soldItems'], recentDays, tz),
    deskOf(db, ids, start, end),
  ]);
  const period = new Set(days);
  const periodMoves = rowsOfDays(moves, period, tz);
  const upTo = new Set(periodDays(addDays(from, -RECENT_LOOKBACK), to));
  return {
    days,
    cov,
    sales: allSales.filter((s) => s.at >= start && s.at < end),
    moves: periodMoves,
    costs: unitCosts(periodMoves, [...moves, ...stockRows]),
    categories: categoriesOf(moves),
    stock: lastStock(rowsOfDays(stockRows, upTo, tz) as BarStock[]),
    recent: recentSold(allSales, recentDays, recentCov, tz),
    desk,
  };
}

/** Итоги строк товаров: выручка, себестоимость и прибыль товаров с себестоимостью, маржа (R40). */
export function barTotals(items: readonly BarRow[]) {
  const costed = items.filter((r) => r.cost !== null);
  const costedRevenue = sum(costed.map((r) => r.revenue));
  const profit = sum(costed.map((r) => r.profit!));
  return {
    soldQty: sum(items.map((r) => r.soldQty)),
    revenue: sum(items.map((r) => r.revenue)),
    cost: costed.length ? sum(costed.map((r) => r.cost!)) : null,
    profit: costed.length ? profit : null,
    margin: costed.length && costedRevenue > 0 ? profit / costedRevenue : null,
    writeOffQty: sum(items.map((r) => r.writeOffQty)),
  };
}

const itemsOf = (d: ClubBarData) => barItems(d);
const hasData = (d: ClubBarData) => d.cov.some((c) => c !== 'none');

/** Маржа бара (R40) для «Обзора»: за период и по дням; день без данных или без товаров с себестоимостью — null. */
export function barMarginFigures(d: ClubBarData, days: readonly string[], tz: string): { total: number | null; byDay: (number | null)[] } {
  const cols = barColumns(d.sales, d.costs, days.map((day) => ({ from: day, to: day })), tz);
  const byDay = cols.map((c, i) => (d.cov[i] === 'none' || c.cost + c.profit <= 0 ? null : c.profit / (c.cost + c.profit)));
  return { total: hasData(d) ? barTotals(itemsOf(d)).margin : null, byDay };
}

/** Плитка «Бара» — в форме плитки «Обзора» (R39). */
const TILES = [
  { key: 'barRevenue', label: 'Выручка бара', unit: 'money', kind: 'sum', value: (t: ReturnType<typeof barTotals>) => t.revenue },
  { key: 'barCost', label: 'Себестоимость', unit: 'money', kind: 'sum', value: (t: ReturnType<typeof barTotals>) => t.cost },
  { key: 'barProfit', label: 'Прибыль бара', unit: 'money', kind: 'sum', value: (t: ReturnType<typeof barTotals>) => t.profit },
  { key: 'barMargin', label: 'Маржа бара', unit: 'percent', kind: 'share', value: (t: ReturnType<typeof barTotals>) => t.margin },
] as const;

const covered = (d: ClubBarData, c: { from: string; to: string }) => d.days.some((day, i) => day >= c.from && day <= c.to && d.cov[i] !== 'none');

/** «≈» у сумм (§2.2): в текущем периоде есть прошедшие дни без данных или прошлый период неполон. */
export function barApprox(cur: ClubBarData, prev: ClubBarData | null, today: string): boolean {
  return cur.days.some((day, i) => day <= today && cur.cov[i] === 'none') || (prev !== null && prev.cov.includes('none'));
}

/** Ответ «Бара» (§8, R39) по данным периода и прошлого периода. */
export function buildBarReport(cur: ClubBarData, prev: ClubBarData | null, q: Pick<BarQuery, 'from' | 'to' | 'step' | 'by'>, ctx: { tz: string; approx: boolean }) {
  const items = itemsOf(cur);
  const total = barTotals(items);
  const prevTotal = prev && hasData(prev) ? barTotals(itemsOf(prev)) : null;
  const columns: ReportColumn[] = reportColumns(q.from, q.to, q.step);
  const cols = barColumns(cur.sales, cur.costs, columns, ctx.tz);
  const series = (['cost', 'profit', 'noCost'] as const).map((id) => ({
    id,
    label: { cost: 'Себестоимость', profit: 'Прибыль', noCost: 'Без себестоимости' }[id],
    values: cols.map((c, i) => (covered(cur, columns[i]!) ? c[id] : null)),
  }));
  const restock = sum(cur.moves.map((m) => m.restockSum));
  const summary = coverageSummary(cur.days, cur.cov);
  return {
    tiles: TILES.map((t) => ({ key: t.key, label: t.label, unit: t.unit, kind: t.kind, value: t.value(total), prev: prevTotal ? t.value(prevTotal) : null, approx: ctx.approx, spark: [] as never[], available: true as const, note: null, href: '' as const })),
    rows: q.by === 'categories' ? barCategories(items) : items,
    total,
    noCost: items.filter((r) => r.cost === null && r.soldQty !== 0).length,
    columns,
    series,
    purchases: { desk: cur.desk, restock, diff: cur.desk - restock },
    coverage: summary,
    prevCoverage: prev ? { days: prev.days.length, withData: prev.cov.filter((c) => c !== 'none').length } : null,
    meta: { from: q.from, to: q.to, step: q.step as ReportStep, by: q.by, empty: summary.withData === 0 },
  };
}

export type BarReport = ReturnType<typeof buildBarReport>;

const text = (value: string): XlsxCell => ({ kind: 'text', value });
const num = (v: number | null, decimals: number): XlsxCell => (v === null ? null : { kind: 'number', value: v.toFixed(decimals), decimals });
const money = (v: number | null): XlsxCell => (v === null ? null : { kind: 'number', value: minorToDecimal(Math.round(v), 2), decimals: 2 });
const qty = (v: number | null): XlsxCell => num(v === null ? null : v / 1000, 3);

/** Колонки листа товаров (§8.1); `items` — только у товаров. */
const SHEET_COLUMNS: { header: string; items?: true; cell: (r: BarRow) => XlsxCell }[] = [
  { header: 'Категория', items: true, cell: (r) => text(r.category) },
  { header: 'Продано', cell: (r) => qty(r.soldQty) },
  { header: 'Выручка', cell: (r) => money(r.revenue) },
  { header: 'Себестоимость', cell: (r) => money(r.cost) },
  { header: 'Прибыль', cell: (r) => money(r.profit) },
  { header: 'Маржа, %', cell: (r) => num(r.margin === null ? null : r.margin * 100, 2) },
  { header: 'Списано', cell: (r) => qty(r.writeOffQty) },
  { header: 'Остаток', items: true, cell: (r) => qty(r.stockQty) },
  { header: 'Хватит на, дней', items: true, cell: (r) => num(r.daysLeft, 2) },
  { header: 'ABC', cell: (r) => text(r.abc) },
];

/** Excel «Бара» (§8): товары или категории, столбцы по шагу, закупки. */
export function barSheets(data: Pick<BarReport, 'rows' | 'columns' | 'series' | 'purchases'>, q: BarQuery): XlsxSheet[] {
  const info = reportInfo({ title: 'Бар', from: q.from, to: q.to, filters: q.project ? 'один клуб' : 'все клубы' });
  const preamble = info.map((line): XlsxCell[] => [text(line)]);
  const cols = SHEET_COLUMNS.filter((c) => q.by === 'items' || !c.items);
  return [
    {
      name: BY_LABEL[q.by],
      preamble,
      columns: [{ header: q.by === 'items' ? 'Товар' : 'Категория', width: 30 }, ...cols.map((c) => ({ header: c.header, width: 14 }))],
      rows: data.rows.map((r) => [text(r.key), ...cols.map((c) => c.cell(r))]),
    },
    {
      name: 'По шагу',
      preamble,
      columns: [{ header: 'Период', width: 16 }, ...data.series.map((s) => ({ header: s.label, width: 18 }))],
      rows: data.columns.map((c, i) => [text(c.label), ...data.series.map((s) => money(s.values[i] ?? null))]),
    },
    {
      name: 'Закупки',
      preamble,
      columns: [
        { header: 'Строка', width: 34 },
        { header: 'Сумма', width: 16 },
      ],
      rows: [
        [text('Закуплено из кассы'), money(data.purchases.desk)],
        [text('Приход в Senet по цене прихода'), money(data.purchases.restock)],
        [text('Разница'), money(data.purchases.diff)],
      ],
    },
  ];
}

export function createClubBar(d: { db: Db; timezone: string; now: () => Date }) {
  const { db, timezone: tz } = d;
  const ids = async (companyId: number, project?: number) => (await clubScope(db, companyId, project)).offices.map((o) => o.id);

  const svc = {
    /** «Бар» (§8, §11). */
    async bar(companyId: number, q: BarQuery) {
      await requireCompany(db, companyId);
      const scope = await clubScope(db, companyId, q.project);
      const offices = scope.offices.map((o) => o.id);
      const today = localParts(d.now().toISOString(), tz).day;
      const p = previousRange(q.from, q.to, today);
      const [cur, prev] = await Promise.all([clubBar(db, tz, offices, q.from, q.to, today), q.compare ? clubBar(db, tz, offices, p.from, p.to, today) : null]);
      return { ...buildBarReport(cur, prev, q, { tz, approx: barApprox(cur, prev, today) }), prevRange: q.compare ? p : null, freshness: scope.freshness };
    },

    /** Продажи товара периода под таблицей (§2.2, R39): по времени, страницы по 50. */
    async rows(companyId: number, q: BarRowsQuery) {
      await requireCompany(db, companyId);
      const { start, end } = bounds(q.from, q.to, tz);
      const sales = (await salesOf(db, await ids(companyId, q.project), start, end)).filter((s) => s.item === q.item);
      const items: CellItem[] = sales.map((s) => ({ at: s.at, kind: 'sale', label: s.item, amount: s.amount, workstation: null, guest: '', phoneMask: null }));
      const next = q.cursor + PAGE;
      return { items: items.slice(q.cursor, next), nextCursor: next < items.length ? String(next) : null };
    },

    /** Excel: таблица, столбцы по шагу и закупки, как на экране. */
    async xlsx(companyId: number, q: BarQuery) {
      const company = await requireCompany(db, companyId);
      const sheets = barSheets(await svc.bar(companyId, q), q);
      return { fileName: exportFileName(company.name, 'Бар', d.now(), tz), data: buildXlsx(sheets, { strings: 'shared' }) };
    },
  };
  return svc;
}

export type ClubBar = ReturnType<typeof createClubBar>;
