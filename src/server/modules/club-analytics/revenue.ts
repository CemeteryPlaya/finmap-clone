import { and, asc, eq, gte, inArray, lt, type AnyColumn } from 'drizzle-orm';
import { combineCoverage, dayCoverage, type DayCoverage } from '../../../shared/club-analytics/coverage';
import { periodDays, previousRange, sumColumns } from '../../../shared/club-analytics/columns';
import { localParts } from '../../../shared/club-analytics/hours';
import { deskByPayment, REVENUE_PARTS, revenueByDay, revenueHeatmap, type RevenueInput, type RevenuePart } from '../../../shared/club-analytics/revenue';
import { addDays, startOfDayUtc } from '../../../shared/dates';
import { reportColumns, type ReportColumn, type ReportStep } from '../../../shared/report-engine';
import type { RevenueQuery, RevenueRowsQuery } from '../../../shared/schemas/club-analytics';
import { shiftPeriodLabel } from '../../../shared/senet-text';
import type { Db } from '../../db/client';
import { senetCashMoves, senetLoad, senetRefills, senetShifts, senetSoldItems, senetTickets, senetTransactions } from '../../db/schema';
import { exportFileName } from '../../http/export-name';
import { buildXlsx, type XlsxCell, type XlsxSheet } from '../../http/xlsx';
import { requireCompany } from '../companies/guard';
import { minorToDecimal } from '../operations/journal-export';
import { reportInfo } from '../analytics/report-export';
import { loadSpans } from '../senet/store';
import type { ReportKind } from '../senet/source';
import { clubScope, type ClubScope } from './scope';

/** Подписи строк «По частям» (§5.1). */
export const PART_LABEL: Record<RevenuePart, string> = {
  packages: 'Абонементы',
  rent: 'Аренда ПК',
  hours: 'Часы',
  bar: 'Бар',
  revenue: 'Выручка',
  refills: 'Справочно: пополнения балансов',
  desk: 'Справочно: деньги в кассу',
  diff: 'Справочно: разница',
};

/** Чем покрыта строка (§3.3): абонементы — `tickets`, аренда ПК — загрузкой, бар — продажами, деньги в кассу — транзакциями. */
const PART_REPORTS: Record<RevenuePart, ReportKind[]> = {
  packages: ['tickets'],
  rent: ['load'],
  hours: ['tickets', 'load'],
  bar: ['soldItems'],
  revenue: ['tickets', 'load', 'soldItems'],
  refills: ['refills'],
  desk: ['transactions'],
  diff: ['tickets', 'load', 'soldItems', 'transactions'],
};
/** Отчёты, без которых день отчёта неполон (§3.3). */
const REPORT_COVERAGE: ReportKind[] = ['tickets', 'load', 'soldItems', 'transactions'];
const COVERED: ReportKind[] = ['tickets', 'load', 'soldItems', 'refills', 'transactions'];
/** Строки выручки; остальные — справочные. */
const REVENUE_ROWS: ReadonlySet<RevenuePart> = new Set(['packages', 'rent', 'hours', 'bar', 'revenue']);
const SHIFT_COLUMNS = [
  ['revenue', 'Выручка'],
  ['bar', 'Бар'],
  ['desk', 'Деньги в кассу'],
  ['refills', 'Пополнения'],
  ['outs', 'Выемки'],
  ['cashAfter', 'Касса Senet после смены'],
] as const;
const CASHIER_COLUMNS = [
  ['revenue', 'Выручка'],
  ['shifts', 'Смен'],
  ['perShift', 'В среднем за смену'],
] as const;
/** Разница смены больше 1 ₸ — «Не сходится со сменами» (§3.4). */
const RECONCILE_TOLERANCE = 100;
const PAGE = 50;

export interface RevenueRow {
  id: string;
  label: string;
  kind: 'part' | 'info' | 'payment' | 'shift' | 'cashier';
  values: (number | null)[];
  total: number | null;
  prevTotal: number | null;
  /** Смена: день открытия в поясе приложения — ссылка на неё в «Сверке». */
  day?: string;
}

/** Строки Senet клуба с полями для списка под ячейкой. */
interface Detail extends RevenueInput {
  load: (RevenueInput['load'][number] & { zone: string; workstation: number | null; guestLogin: string; phoneMask: string | null })[];
  tickets: (RevenueInput['tickets'][number] & { ticket: string; guestLogin: string; phoneMask: string | null })[];
  sold: (RevenueInput['sold'][number] & { item: string })[];
  refills: (RevenueInput['refills'][number] & { guestLogin: string; phoneMask: string | null; workstation: number | null })[];
}

type Shift = typeof senetShifts.$inferSelect;

/** Моменты UTC начала первого дня и дня после последнего. */
const bounds = (from: string, to: string, tz: string) => ({ start: startOfDayUtc(from, tz), end: startOfDayUtc(addDays(to, 1), tz) });
const within = <T extends { officeId: AnyColumn }>(t: T, at: AnyColumn, ids: number[], start: string, end: string) => and(inArray(t.officeId, ids), gte(at, start), lt(at, end));
const sum = (xs: readonly (number | null)[]): number | null => (xs.every((x) => x === null) ? null : xs.reduce<number>((t, x) => t + (x ?? 0), 0));

async function loadDetail(db: Db, ids: number[], start: string, end: string): Promise<Detail> {
  if (!ids.length) return { load: [], tickets: [], sold: [], refills: [], transactions: [] };
  const [load, tickets, sold, refills, transactions] = await Promise.all([
    db
      .select({ startAt: senetLoad.startAt, endAt: senetLoad.endAt, debited: senetLoad.debited, zone: senetLoad.zone, workstation: senetLoad.workstation, guestLogin: senetLoad.guestLogin, phoneMask: senetLoad.phoneMask })
      .from(senetLoad)
      .where(within(senetLoad, senetLoad.startAt, ids, start, end))
      .orderBy(asc(senetLoad.startAt)),
    db
      .select({ at: senetTickets.at, price: senetTickets.price, ticket: senetTickets.ticket, guestLogin: senetTickets.guestLogin, phoneMask: senetTickets.phoneMask })
      .from(senetTickets)
      .where(within(senetTickets, senetTickets.at, ids, start, end))
      .orderBy(asc(senetTickets.at)),
    db.select({ at: senetSoldItems.at, qty: senetSoldItems.qty, amount: senetSoldItems.amount, refund: senetSoldItems.refund, item: senetSoldItems.item }).from(senetSoldItems).where(within(senetSoldItems, senetSoldItems.at, ids, start, end)).orderBy(asc(senetSoldItems.at)),
    db
      .select({ at: senetRefills.at, amount: senetRefills.amount, accountType: senetRefills.accountType, guestLogin: senetRefills.guestLogin, phoneMask: senetRefills.phoneMask, workstation: senetRefills.workstation })
      .from(senetRefills)
      .where(within(senetRefills, senetRefills.at, ids, start, end))
      .orderBy(asc(senetRefills.at)),
    db.select({ at: senetTransactions.at, kind: senetTransactions.kind, amount: senetTransactions.amount, payment: senetTransactions.payment }).from(senetTransactions).where(within(senetTransactions, senetTransactions.at, ids, start, end)).orderBy(asc(senetTransactions.at)),
  ]);
  return { load, tickets, sold, refills, transactions };
}

/** Покрытие дней по отчётам (§3.2, R1): у «Все клубы» день полон, только если полон у каждого клуба; без клубов — нет данных. */
async function coverageOf(db: Db, ids: number[], days: readonly string[], tz: string): Promise<Map<ReportKind, DayCoverage[]>> {
  const { start, end } = bounds(days[0]!, days.at(-1)!, tz);
  const spans = await loadSpans(db, ids, COVERED, start, end);
  const none = days.map((): DayCoverage => 'none');
  return new Map(COVERED.map((r) => [r, ids.length ? combineCoverage(ids.map((id) => dayCoverage(spans.get(id)!.get(r)!, days, tz))) : none]));
}

const partCoverage = (cov: Map<ReportKind, DayCoverage[]>, part: RevenuePart) => combineCoverage(PART_REPORTS[part].map((r) => cov.get(r)!));

/** Период клуба: дни, строки Senet, покрытие. */
interface Period {
  days: string[];
  detail: Detail;
  cov: Map<ReportKind, DayCoverage[]>;
}

async function periodOf(db: Db, ids: number[], from: string, to: string, tz: string, until?: string): Promise<Period> {
  const days = periodDays(from, to);
  const { start, end } = bounds(from, to, tz);
  const [detail, cov] = await Promise.all([loadDetail(db, ids, start, until && until > end ? until : end), coverageOf(db, ids, days, tz)]);
  return { days, detail, cov };
}

/** Итог строки прошлого периода: null, если в нём нет дней с данными (§2.2). */
function prevTotals(prev: Period | null, tz: string): Record<RevenuePart, number | null> | null {
  if (!prev) return null;
  const byDay = revenueByDay(prev.detail, prev.days, tz);
  const total = (part: RevenuePart) => {
    const cov = partCoverage(prev.cov, part);
    return sum(byDay[part].map((v, i) => (cov[i] === 'none' ? null : v)));
  };
  return Object.fromEntries(REVENUE_PARTS.map((p) => [p, total(p)])) as Record<RevenuePart, number | null>;
}

function partRows(p: Period, columns: ReportColumn[], tz: string, prev: Record<RevenuePart, number | null> | null): RevenueRow[] {
  const byDay = revenueByDay(p.detail, p.days, tz);
  return REVENUE_PARTS.map((part) => {
    const values = sumColumns(byDay[part], p.days, columns, partCoverage(p.cov, part)).values;
    return { id: part, label: PART_LABEL[part], kind: REVENUE_ROWS.has(part) ? 'part' : 'info', values, total: sum(values), prevTotal: prev?.[part] ?? null };
  });
}

function paymentRows(p: Period, columns: ReportColumn[], tz: string): RevenueRow[] {
  const cov = p.cov.get('transactions')!;
  return [...deskByPayment(p.detail.transactions, p.days, tz)].map(([payment, byDay]) => {
    const values = sumColumns(byDay, p.days, columns, cov).values;
    return { id: `payment:${payment}`, label: payment, kind: 'payment', values, total: sum(values), prevTotal: null };
  });
}

/** Смены клубов, открытые в периоде (§3.4, §5.2), по времени открытия. */
async function shiftsOf(db: Db, ids: number[], start: string, end: string): Promise<Shift[]> {
  if (!ids.length) return [];
  return db.select().from(senetShifts).where(within(senetShifts, senetShifts.openedAt, ids, start, end)).orderBy(asc(senetShifts.openedAt), asc(senetShifts.id));
}

/** Суммы строк Senet в окне смены `[openedAt, closedAt]`; сеанс — по началу. */
function shiftSums(d: Detail, s: Shift, now: string) {
  const until = s.closedAt ?? now;
  const inShift = (at: string) => at >= s.openedAt && at <= until;
  const hours = d.load.filter((r) => inShift(r.startAt)).reduce((t, r) => t + r.debited, 0) + d.tickets.filter((r) => inShift(r.at)).reduce((t, r) => t + r.price, 0);
  const bar = d.sold.filter((r) => r.qty !== null && inShift(r.at)).reduce((t, r) => t + (r.refund ? -r.amount : r.amount), 0);
  const desk = d.transactions.filter((r) => inShift(r.at)).reduce((t, r) => t + (r.kind === 'refund' ? -r.amount : r.amount), 0);
  const refills = d.refills.filter((r) => inShift(r.at)).reduce((t, r) => t + r.amount, 0);
  return { revenue: hours + bar, bar, desk, refills };
}

async function outsOf(db: Db, shifts: readonly Shift[]): Promise<Map<number, number>> {
  if (!shifts.length) return new Map();
  const moves = await db
    .select({ shiftId: senetCashMoves.shiftId, amount: senetCashMoves.amount })
    .from(senetCashMoves)
    .where(and(inArray(senetCashMoves.shiftId, shifts.map((s) => s.id)), eq(senetCashMoves.kind, 'out'), eq(senetCashMoves.missingInSenet, false)));
  const out = new Map<number, number>();
  for (const m of moves) out.set(m.shiftId, (out.get(m.shiftId) ?? 0) + m.amount);
  return out;
}

const cashierOf = (s: Shift) => s.closedBy ?? s.openedBy;

function shiftRows(d: Detail, shifts: readonly Shift[], outs: Map<number, number>, tz: string, now: string): RevenueRow[] {
  return shifts.map((s) => {
    const x = shiftSums(d, s, now);
    const values = [x.revenue, x.bar, x.desk, x.refills, outs.get(s.id) ?? 0, s.endBalance];
    return { id: `shift:${s.id}`, label: `${shiftPeriodLabel(s.openedAt, s.closedAt, tz)} · ${cashierOf(s)}`, kind: 'shift', values, total: null, prevTotal: null, day: localParts(s.openedAt, tz).day };
  });
}

function cashierRows(d: Detail, shifts: readonly Shift[], now: string): RevenueRow[] {
  const by = new Map<string, { revenue: number; shifts: number }>();
  for (const s of shifts.filter((x) => x.closedAt !== null)) {
    const c = by.get(cashierOf(s)) ?? { revenue: 0, shifts: 0 };
    by.set(cashierOf(s), { revenue: c.revenue + shiftSums(d, s, now).revenue, shifts: c.shifts + 1 });
  }
  return [...by].map(([name, c]) => ({ id: `cashier:${name}`, label: name, kind: 'cashier', values: [c.revenue, c.shifts, Math.round(c.revenue / c.shifts)], total: null, prevTotal: null }));
}

/** Сходимость (§3.4): закрытые смены периода — Σ выручки смен против Σ транзакций в их границах. */
function reconcileOf(d: Detail, shifts: readonly Shift[], now: string) {
  const closed = shifts.filter((s) => s.closedAt !== null);
  const rows = closed.map((s) => ({ s, desk: shiftSums(d, s, now).desk }));
  return {
    shifts: closed.length,
    desk: rows.reduce((t, r) => t + r.desk, 0),
    revenue: closed.reduce((t, s) => t + s.revenue, 0),
    diffShifts: rows.filter((r) => Math.abs(r.desk - r.s.revenue) > RECONCILE_TOLERANCE).map((r) => ({ id: r.s.id, openedAt: r.s.openedAt, diff: r.desk - r.s.revenue })),
  };
}

const keyColumns = (defs: readonly (readonly [string, string])[]): ReportColumn[] => defs.map(([key, label]) => ({ key, from: '', to: '', label }));

function coverageSummary(p: Period, columns: ReportColumn[]) {
  const cov = combineCoverage(REPORT_COVERAGE.map((r) => p.cov.get(r)!));
  const per = sumColumns(p.days.map(() => 0), p.days, columns, cov);
  return {
    days: p.days.length,
    withData: cov.filter((c) => c !== 'none').length,
    partial: cov.filter((c) => c === 'partial').length,
    missingDays: p.days.filter((_, i) => cov[i] === 'none'),
    columns: columns.map((_, i) => ({ withData: per.withData[i]!, total: per.total[i]! })),
    byDay: cov,
  };
}

/** Части выручки по дням периода (§4): день без данных части — null; покрытие — сводка отчёта и по дням строки «Выручка». */
export interface ClubDays {
  days: string[];
  parts: Record<RevenuePart, (number | null)[]>;
  revenueCoverage: DayCoverage[];
  coverage: { days: number; withData: number; partial: number; missingDays: string[] };
}

export async function clubDays(db: Db, tz: string, ids: number[], from: string, to: string): Promise<ClubDays> {
  const p = await periodOf(db, ids, from, to, tz);
  const byDay = revenueByDay(p.detail, p.days, tz);
  const parts = Object.fromEntries(
    REVENUE_PARTS.map((part) => {
      const cov = partCoverage(p.cov, part);
      return [part, byDay[part].map((v, i) => (cov[i] === 'none' ? null : v))];
    }),
  ) as Record<RevenuePart, (number | null)[]>;
  const { byDay: _, columns: __, ...coverage } = coverageSummary(p, []);
  return { days: p.days, parts, revenueCoverage: partCoverage(p.cov, 'revenue'), coverage };
}

/** Данные отчёта: клубы, смены периода, период и прошлый период, колонки шага. */
interface Built {
  scope: ClubScope;
  shifts: Shift[];
  p: Period;
  prev: Period | null;
  columns: ReportColumn[];
}

/** Конец выборки строк: ночная смена, закрытая после конца периода, считается целиком (§3.4). */
function shiftsEnd(shifts: readonly Shift[], end: string): string {
  const last = shifts.reduce((t, s) => (s.closedAt && s.closedAt > t ? s.closedAt : t), '');
  return last >= end ? new Date(Date.parse(last) + 1).toISOString() : end;
}

async function buildRevenue(db: Db, tz: string, companyId: number, q: RevenueQuery): Promise<Built> {
  await requireCompany(db, companyId);
  const scope = await clubScope(db, companyId, q.project);
  const ids = scope.offices.map((o) => o.id);
  const { start, end } = bounds(q.from, q.to, tz);
  const shifts = await shiftsOf(db, ids, start, end);
  const p = await periodOf(db, ids, q.from, q.to, tz, shiftsEnd(shifts, end));
  const prevRange = previousRange(q.from, q.to);
  const prev = q.compare ? await periodOf(db, ids, prevRange.from, prevRange.to, tz) : null;
  return { scope, shifts, p, prev, columns: reportColumns(q.from, q.to, q.step) };
}

/** Строки и колонки разреза (§5.2): по сменам и кассирам колонки — свои, шаг не действует. */
async function rowsOf(db: Db, tz: string, now: string, by: RevenueQuery['by'], b: Built): Promise<{ columns: ReportColumn[]; rows: RevenueRow[] }> {
  switch (by) {
    case 'payment':
      return { columns: b.columns, rows: paymentRows(b.p, b.columns, tz) };
    case 'shifts':
      return { columns: keyColumns(SHIFT_COLUMNS), rows: shiftRows(b.p.detail, b.shifts, await outsOf(db, b.shifts), tz, now) };
    case 'cashiers':
      return { columns: keyColumns(CASHIER_COLUMNS), rows: cashierRows(b.p.detail, b.shifts, now) };
    default:
      return { columns: b.columns, rows: partRows(b.p, b.columns, tz, prevTotals(b.prev, tz)) };
  }
}

type RevenueReport = Awaited<ReturnType<ClubRevenue['revenue']>>;

const moneyCell = (v: number | null): XlsxCell => (v === null ? null : { kind: 'number', value: minorToDecimal(v, 2), decimals: 2 });
const countCell = (v: number | null): XlsxCell => (v === null ? null : { kind: 'number', value: String(v), decimals: 0 });

/** Лист Excel «Выручки клуба», как таблица на экране; «Итого» — у разрезов по колонкам шага. */
export function revenueSheet(data: RevenueReport, q: RevenueQuery): XlsxSheet {
  const byStep = q.by === 'parts' || q.by === 'payment';
  // у кассиров вторая колонка — число смен, не деньги
  const cell = (v: number | null, i: number) => (q.by === 'cashiers' && i === 1 ? countCell(v) : moneyCell(v));
  const info = reportInfo({ title: 'Выручка клуба', from: q.from, to: q.to, step: byStep ? q.step : undefined, filters: q.project ? 'один клуб' : 'все клубы' });
  return {
    name: 'Выручка клуба',
    preamble: info.map((line): XlsxCell[] => [{ kind: 'text', value: line }]),
    columns: [{ header: 'Строка', width: 40 }, ...data.columns.map((c) => ({ header: c.label, width: 16 })), ...(byStep ? [{ header: 'Итого', width: 16 }] : [])],
    rows: data.rows.map((r) => [{ kind: 'text', value: r.label }, ...r.values.map(cell), ...(byStep ? [moneyCell(r.total)] : [])]),
  };
}

/** Колонка ячейки: дата начала колонки шага или весь период; не из периода — null. */
function cellRange(q: RevenueRowsQuery): { from: string; to: string } | null {
  if (q.col === 'total') return { from: q.from, to: q.to };
  return reportColumns(q.from, q.to, q.step).find((c) => c.key === q.col) ?? null;
}

export function createClubRevenue(d: { db: Db; timezone: string; now: () => Date }) {
  const { db, timezone: tz } = d;
  const svc = {
    /** «Выручка клуба» (§5, §11). */
    async revenue(companyId: number, q: RevenueQuery) {
      const b = await buildRevenue(db, tz, companyId, q);
      const now = d.now().toISOString();
      const { columns, rows } = await rowsOf(db, tz, now, q.by, b);
      const { byDay, ...coverage } = coverageSummary(b.p, b.columns);
      return {
        columns,
        rows,
        heatmap: q.view === 'hours' ? revenueHeatmap(b.p.detail, b.p.days, byDay, tz) : undefined,
        coverage,
        prevCoverage: b.prev ? { days: b.prev.days.length, withData: coverageSummary(b.prev, []).withData } : null,
        reconcile: reconcileOf(b.p.detail, b.shifts, now),
        freshness: b.scope.freshness,
        meta: { from: q.from, to: q.to, step: q.step as ReportStep, by: q.by, empty: coverage.withData === 0 },
      };
    },

    /** Строки Senet ячейки (§2.2): страницы по 50; колонка не из периода — пусто. */
    async rows(companyId: number, q: RevenueRowsQuery) {
      await requireCompany(db, companyId);
      const scope = await clubScope(db, companyId, q.project);
      const col = cellRange(q);
      if (!col) return { items: [], nextCursor: null };
      const { start, end } = bounds(col.from, col.to, tz);
      const items = cellItems(await loadDetail(db, scope.offices.map((o) => o.id), start, end), q.row);
      const next = q.cursor + PAGE;
      return { items: items.slice(q.cursor, next), nextCursor: next < items.length ? String(next) : null };
    },

    /** Excel (§2.6 спецификации «Аналитика»): таблица, как на экране. */
    async xlsx(companyId: number, q: RevenueQuery) {
      const company = await requireCompany(db, companyId);
      const sheet = revenueSheet(await svc.revenue(companyId, q), q);
      return { fileName: exportFileName(company.name, 'Выручка клуба', d.now(), tz), data: buildXlsx(sheet, { strings: 'shared' }) };
    },
  };
  return svc;
}

/** Строка Senet под ячейкой (§2.2). Телефон — только маска (§12). */
export interface CellItem {
  at: string;
  kind: 'session' | 'package' | 'sale' | 'refill' | 'transaction';
  label: string;
  amount: number;
  workstation: number | null;
  guest: string;
  phoneMask: string | null;
}

/** Строки ячейки по строке отчёта, по времени. */
function cellItems(dt: Detail, row: RevenueRowsQuery['row']): CellItem[] {
  const sessions = (): CellItem[] =>
    dt.load.map((r) => ({ at: r.startAt, kind: 'session', label: [r.zone, r.workstation === null ? '' : `ПК ${r.workstation}`].filter(Boolean).join(' · '), amount: r.debited, workstation: r.workstation, guest: r.guestLogin, phoneMask: r.phoneMask }));
  const sales = (): CellItem[] => dt.sold.filter((r) => r.qty !== null).map((r) => ({ at: r.at, kind: 'sale', label: r.item, amount: r.refund ? -r.amount : r.amount, workstation: null, guest: '', phoneMask: null }));
  const packages = (): CellItem[] => dt.tickets.map((r) => ({ at: r.at, kind: 'package', label: r.ticket, amount: r.price, workstation: null, guest: r.guestLogin, phoneMask: r.phoneMask }));
  const refills = (): CellItem[] =>
    dt.refills.map((r) => ({ at: r.at, kind: 'refill', label: r.accountType, amount: r.amount, workstation: r.workstation, guest: r.guestLogin, phoneMask: r.phoneMask }));
  const desk = (): CellItem[] => dt.transactions.map((r) => ({ at: r.at, kind: 'transaction', label: r.payment, amount: r.kind === 'refund' ? -r.amount : r.amount, workstation: null, guest: '', phoneMask: null }));
  const pick: Record<RevenueRowsQuery['row'], () => CellItem[]> = {
    packages,
    rent: sessions,
    hours: () => [...sessions(), ...packages()],
    bar: sales,
    revenue: () => [...sessions(), ...packages(), ...sales()],
    refills,
    desk,
  };
  return pick[row]().sort((a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : 0));
}

export type ClubRevenue = ReturnType<typeof createClubRevenue>;
