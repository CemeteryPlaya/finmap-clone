import { and, eq } from 'drizzle-orm';
import { BUILT_CLUB_REPORTS, CLUB_TILES, resolveTiles, TILE_SOON, type SavedTiles, type TileDef } from '../../../shared/analytics-catalog';
import { previousRange } from '../../../shared/club-analytics/columns';
import type { DayCoverage } from '../../../shared/club-analytics/coverage';
import { localParts } from '../../../shared/club-analytics/hours';
import { guestBuckets, type GuestFigures } from '../../../shared/club-analytics/guests';
import { extremeHours, loadByDay, loadHeatmap, loadTotal, sumZones } from '../../../shared/club-analytics/load';
import type { OverviewQuery } from '../../../shared/schemas/club-analytics';
import type { Db } from '../../db/client';
import { categories } from '../../db/schema';
import { exportFileName } from '../../http/export-name';
import { buildXlsx, type XlsxCell, type XlsxSheet } from '../../http/xlsx';
import { requireCompany } from '../companies/guard';
import { excelDate, minorToDecimal } from '../operations/journal-export';
import { reportInfo } from '../analytics/report-export';
import type { AnalyticsService } from '../analytics/service';
import { clubGuests, type ClubGuestsData } from './guests';
import { clubLoad, type ClubLoadData } from './load';
import { clubDays, type ClubDays } from './revenue';
import { CLUB_TEMPLATE, clubScope, NO_PC_NOTE, pcsOf, type ClubScope } from './scope';
import type { AnalyticsSettings } from './settings';

export interface OverviewTile {
  key: string;
  label: string;
  unit: TileDef['unit'];
  /** Как считать Δ (§2.2): сумма, среднее по дням или доля. */
  kind: 'sum' | 'avg' | 'share';
  value: number | null;
  prev: number | null;
  approx: boolean;
  spark: (number | null)[];
  available: boolean;
  note: string | null;
  /** Хвост адреса после `/c/:id/analytics/`; у недоступной плитки — пусто. */
  href: string;
}

/** Лучших и худших дней (§4). */
const BEST = 3;
/** Ссылка плитки по отчёту: метрики журнала — «Прибыль». */
const REPORT_HREF: Partial<Record<TileDef['report'], string>> = { revenue: 'club/revenue', load: 'club/load', guests: 'club/guests', journal: 'pnl' };
/** Плитки-средние (§2.2, R8): Δ — как у среднего, без «≈». */
const AVG_TILES = new Set(['revenuePerPcDay', 'revenuePerGuest', 'visitDuration', 'visitsPerGuest']);

const total = (xs: readonly (number | null)[]): number | null => (xs.every((x) => x === null) ? null : xs.reduce<number>((t, x) => t + (x ?? 0), 0));
const ratio = (a: number | null, b: number | null): number | null => (a === null || b === null || b === 0 ? null : a / b);

const tileKind = (t: TileDef): OverviewTile['kind'] => (t.unit === 'percent' ? 'share' : AVG_TILES.has(t.key) ? 'avg' : 'sum');

/** Метрики журнала периода (§4): расходы на зарплату и аренду проектов-клубов. */
interface Journal {
  payroll: number;
  rent: number;
}

/** Загрузка периода для «Обзора» (§4): за период, по дням, карта. */
export interface LoadFigures {
  total: number | null;
  byDay: (number | null)[];
  heatmap: (number | null)[][];
}

/** Гости периода для «Обзора» (§4): за период и по дням. */
export interface GuestDayFigures {
  total: GuestFigures;
  byDay: GuestFigures[];
}

/** Период «Обзора»: части выручки по дням, загрузка и — если есть плитки гостей — гости. */
type Period = ClubDays & { load: LoadFigures; guests: GuestDayFigures | null };

export function loadFigures(l: ClubLoadData): LoadFigures {
  const all = sumZones(l.occ, l.days.length);
  return { total: loadTotal(all, l.seats, l.cov), byDay: loadByDay(all, l.seats, l.cov), heatmap: loadHeatmap(all, l.seats, l.days, l.cov) };
}

/** Гости дней `days` (§4): визиты и первые визиты — за всё время, поэтому одни данные годятся для любого периода. */
export function guestFigures(g: Pick<ClubGuestsData, 'visits' | 'first'>, tz: string, days: readonly string[]): GuestDayFigures {
  const [total] = guestBuckets(g.visits, g.first, [{ from: days[0]!, to: days.at(-1)! }], tz);
  return { total: total!, byDay: guestBuckets(g.visits, g.first, days.map((day) => ({ from: day, to: day })), tz) };
}

/** Ряд гостей по дням (§4): день без данных выручки — null. */
const guestDaily = (d: Period, f: (x: GuestFigures, i: number) => number | null) => d.guests!.byDay.map((x, i) => (d.revenueCoverage[i] === 'none' ? null : f(x, i)));

/** Плитка гостей: значение — по итогу периода, ряд — по дням. */
const guestMeasure =
  (f: (x: GuestFigures, d: Period, i: number | null) => number | null): Measure =>
  (d) => ({ value: f(d.guests!.total, d, null), spark: guestDaily(d, (x, i) => f(x, d, i)) });

/** Выручка периода (`i` = null) или дня. */
const revenueOf = (d: Period, i: number | null) => (i === null ? total(d.parts.revenue) : (d.parts.revenue[i] ?? null));

type Measure = (d: Period, pcs: number, j: Journal | null) => { value: number | null; spark: (number | null)[] };

/** Значение и ряд плиток, которые считает АК-1 (§4, R8): по частям выручки по дням и метрикам журнала. */
const MEASURES: Record<string, Measure> = {
  revenue: (d) => ({ value: total(d.parts.revenue), spark: d.parts.revenue }),
  load: (d) => ({ value: d.load.total, spark: d.load.byDay }),
  refills: (d) => ({ value: total(d.parts.refills), spark: d.parts.refills }),
  barShare: ({ parts: { bar, revenue } }) => ({ value: ratio(total(bar), total(revenue)), spark: bar.map((b, i) => ratio(b, revenue[i] ?? null)) }),
  revenuePerPcDay: ({ parts: { hours } }, pcs) => ({ value: ratio(total(hours), pcs * hours.filter((h) => h !== null).length), spark: hours.map((h) => ratio(h, pcs)) }),
  payrollToRevenue: (d, _, j) => ({ value: j && ratio(j.payroll, total(d.parts.revenue)), spark: [] }),
  rentToRevenue: (d, _, j) => ({ value: j && ratio(j.rent, total(d.parts.revenue)), spark: [] }),
  guests: guestMeasure((x) => x.guests),
  newGuests: guestMeasure((x) => x.newGuests),
  revenuePerGuest: guestMeasure((x, d, i) => ratio(revenueOf(d, i), x.guests)),
  visitDuration: guestMeasure((x) => ratio(x.visitSec, x.visits)),
  visitsPerGuest: guestMeasure((x) => ratio(x.visits, x.guests)),
  returningShare: guestMeasure((x) => ratio(x.returning, x.guests)),
};

/** Почему плитка недоступна (§15, §6.1): нет её отчёта, количества ПК или расчёта; доступна — null. */
function unavailable(def: TileDef, pcs: number): string | null {
  if (!BUILT_CLUB_REPORTS.has(def.report)) return TILE_SOON[def.report as keyof typeof TILE_SOON];
  if (def.key === 'revenuePerPcDay' && pcs === 0) return NO_PC_NOTE;
  return MEASURES[def.key] ? null : '';
}

/** Плитка: недоступная — с пометкой; иначе — значение, прошлый период и ряд. */
function tileOf(def: TileDef, cur: Period, prev: Period | null, pcs: number, j: { cur: Journal; prev: Journal | null }, approx: boolean): OverviewTile {
  const base = { key: def.key, label: def.label, unit: def.unit, kind: tileKind(def), approx };
  const note = unavailable(def, pcs);
  if (note !== null) return { ...base, value: null, prev: null, spark: [], available: false, note: note || null, href: '' };
  const measure = MEASURES[def.key]!;
  const now = measure(cur, pcs, j.cur);
  return { ...base, value: now.value, prev: prev ? measure(prev, pcs, j.prev).value : null, spark: now.spark, available: true, note: null, href: REPORT_HREF[def.report] ?? '' };
}

/** Δ сумм с «≈» (§2.2): в текущем периоде есть прошедшие дни без данных или прошлый период неполон. */
export function approxOf(cur: ClubDays['coverage'], prev: ClubDays['coverage'] | null, today: string): boolean {
  return cur.missingDays.some((day) => day <= today) || (prev !== null && prev.withData < prev.days);
}

/** Лучшие и худшие дни (§4): только полные дни с данными; дней меньше шести — списки не пересекаются, сначала лучшие. */
export function bestWorst(days: readonly { day: string; revenue: number | null; coverage: DayCoverage }[]) {
  const full = days.filter((d): d is { day: string; revenue: number; coverage: 'full' } => d.coverage === 'full' && d.revenue !== null).map(({ day, revenue }) => ({ day, revenue }));
  const byDay = (a: { day: string }, b: { day: string }) => (a.day < b.day ? -1 : a.day > b.day ? 1 : 0);
  const best = [...full].sort((a, b) => b.revenue - a.revenue || byDay(a, b)).slice(0, BEST);
  const taken = new Set(best.map((d) => d.day));
  const worst = full
    .filter((d) => !taken.has(d.day))
    .sort((a, b) => a.revenue - b.revenue || byDay(a, b))
    .slice(0, BEST);
  return { best, worst };
}

/** Видимые плитки в порядке настройки (§10.2); настройки шаблона нет (все клубы в архиве) — плитки по умолчанию. */
export function visibleTileDefs(saved: SavedTiles | undefined): TileDef[] {
  return (saved ?? resolveTiles(null, CLUB_TILES)).items.filter((i) => i.visible).flatMap((i) => CLUB_TILES.filter((t) => t.key === i.key));
}


/** Сумма в тиынах или доля — ячейка Excel. */
function tileCell(t: OverviewTile, v: number | null): XlsxCell {
  if (v === null) return t.available ? null : { kind: 'text', value: t.note ?? '' };
  if (t.unit === 'percent') return { kind: 'number', value: (v * 100).toFixed(2), decimals: 2 };
  if (t.unit === 'money') return { kind: 'number', value: minorToDecimal(Math.round(v), 2), decimals: 2 };
  return { kind: 'number', value: String(v), decimals: 0 };
}

const COVERAGE_TEXT: Record<DayCoverage, string> = { full: 'полные', partial: 'неполные', none: 'нет данных' };

type OverviewReport = Awaited<ReturnType<ClubOverview['overview']>>;

/** Excel «Обзора» (§4): лист плиток и лист ряда по дням. */
export function overviewSheets(data: OverviewReport, q: OverviewQuery): XlsxSheet[] {
  const info = reportInfo({ title: 'Обзор клуба', from: q.from, to: q.to, filters: q.project ? 'один клуб' : 'все клубы' });
  const preamble = info.map((line): XlsxCell[] => [{ kind: 'text', value: line }]);
  const label = (t: OverviewTile) => (t.unit === 'percent' ? `${t.label}, %` : t.label);
  return [
    {
      name: 'Плитки',
      preamble,
      columns: [{ header: 'Плитка', width: 36 }, { header: 'За период', width: 18 }, ...(q.compare ? [{ header: 'Прошлый период', width: 18 }] : [])],
      rows: data.tiles.map((t) => [{ kind: 'text', value: label(t) }, tileCell(t, t.value), ...(q.compare ? [tileCell(t, t.prev)] : [])]),
    },
    {
      name: 'По дням',
      preamble,
      columns: [
        { header: 'День', width: 14 },
        { header: 'Выручка', width: 18 },
        { header: 'Загрузка, %', width: 14 },
        { header: 'Данные', width: 14 },
      ],
      rows: data.days.map((d) => [
        { kind: 'date', value: excelDate(d.day) },
        d.revenue === null ? null : { kind: 'number', value: minorToDecimal(d.revenue, 2), decimals: 2 },
        d.load === null ? null : { kind: 'number', value: (d.load * 100).toFixed(2), decimals: 2 },
        { kind: 'text', value: COVERAGE_TEXT[d.coverage] },
      ]),
    },
  ];
}

/** Части выручки по дням и загрузка периода; гости — по визитам за всё время, загруженным один раз на оба периода. */
async function overviewPeriod(db: Db, tz: string, c: { scope: ClubScope; now: string; guests: Promise<ClubGuestsData | null> }, from: string, to: string): Promise<Period> {
  const ids = c.scope.offices.map((o) => o.id);
  const [days, load, guests] = await Promise.all([clubDays(db, tz, ids, from, to), clubLoad(db, tz, c.scope, from, to, c.now), c.guests]);
  return { ...days, load: loadFigures(load), guests: guests && guestFigures(guests, tz, days.days) };
}

export function createClubOverview(d: { db: Db; timezone: string; now: () => Date; settings: AnalyticsSettings; analytics: Pick<AnalyticsService, 'dealTotal'> }) {
  const { db, timezone: tz } = d;

  /** Категории метрик журнала (§4): под системной «Зарплатой» и «Аренда» шаблона — с подкатегориями. */
  async function journalCategories(companyId: number) {
    const salary = await db
      .select({ id: categories.id })
      .from(categories)
      .where(and(eq(categories.companyId, companyId), eq(categories.kind, 'expense'), eq(categories.systemKey, 'salary')));
    const rent = await db
      .select({ id: categories.id })
      .from(categories)
      .where(and(eq(categories.companyId, companyId), eq(categories.kind, 'expense'), eq(categories.templateRef, `${CLUB_TEMPLATE}:rent`)));
    return { salary: salary.map((c) => c.id), rent: rent.map((c) => c.id) };
  }

  async function journal(companyId: number, projectIds: number[], range: { from: string; to: string }, cats: { salary: number[]; rent: number[] }): Promise<Journal> {
    const [payroll, rent] = await Promise.all([
      d.analytics.dealTotal(companyId, { ...range, projectIds, categoryIds: cats.salary }),
      d.analytics.dealTotal(companyId, { ...range, projectIds, categoryIds: cats.rent }),
    ]);
    return { payroll, rent };
  }

  /** Метрики журнала периода и прошлого периода — только если среди плиток есть плитки журнала. */
  async function journalOf(companyId: number, projectIds: number[], defs: readonly TileDef[], range: { from: string; to: string }, prevRange: { from: string; to: string } | null) {
    if (!defs.some((t) => t.report === 'journal')) return { cur: { payroll: 0, rent: 0 }, prev: null };
    const cats = await journalCategories(companyId);
    return { cur: await journal(companyId, projectIds, range, cats), prev: prevRange ? await journal(companyId, projectIds, prevRange, cats) : null };
  }

  const periodOf = (scope: ClubScope, from: string, to: string, now: string, guests: Promise<ClubGuestsData | null>) => overviewPeriod(db, tz, { scope, now, guests }, from, to);

  /** Видимые плитки шаблона в порядке настройки (§10.2). */
  async function visibleTiles(companyId: number): Promise<TileDef[]> {
    return visibleTileDefs((await d.settings.get(companyId)).tiles[CLUB_TEMPLATE]);
  }

  const svc = {
    /** «Обзор клуба» (§4, §11). */
    async overview(companyId: number, q: OverviewQuery) {
      await requireCompany(db, companyId);
      const [scope, defs] = await Promise.all([clubScope(db, companyId, q.project), visibleTiles(companyId)]);
      const prevRange = previousRange(q.from, q.to);
      const now = d.now().toISOString();
      // гости — только если среди плиток есть плитки гостей (как журнал); визиты за всё время — одни на оба периода
      const guests = defs.some((t) => t.report === 'guests') ? clubGuests(db, tz, companyId, scope, q.from, q.to, now) : Promise.resolve(null);
      const [cur, prev] = await Promise.all([periodOf(scope, q.from, q.to, now, guests), q.compare ? periodOf(scope, prevRange.from, prevRange.to, now, guests) : null]);
      const j = await journalOf(companyId, scope.projects.map((p) => p.id), defs, { from: q.from, to: q.to }, q.compare ? prevRange : null);
      const today = localParts(now, tz).day;
      const approx = approxOf(cur.coverage, prev?.coverage ?? null, today);
      const pcs = pcsOf(scope);
      const days = cur.days.map((day, i) => ({ day, revenue: cur.parts.revenue[i]!, load: cur.load.byDay[i] ?? null, coverage: cur.revenueCoverage[i]! }));
      return {
        tiles: defs.map((t) => tileOf(t, cur, prev, pcs, j, approx)),
        days,
        ...bestWorst(days),
        peak: extremeHours(cur.load.heatmap, 3, 'max'),
        coverage: cur.coverage,
        prevCoverage: prev ? { days: prev.coverage.days, withData: prev.coverage.withData } : null,
        freshness: scope.freshness,
        meta: { from: q.from, to: q.to, empty: cur.coverage.withData === 0 },
      };
    },

    /** Excel (§4): плитки и ряд по дням. */
    async xlsx(companyId: number, q: OverviewQuery) {
      const company = await requireCompany(db, companyId);
      const sheets = overviewSheets(await svc.overview(companyId, q), q);
      return { fileName: exportFileName(company.name, 'Обзор клуба', d.now(), tz), data: buildXlsx(sheets, { strings: 'shared' }) };
    },
  };
  return svc;
}

export type ClubOverview = ReturnType<typeof createClubOverview>;
