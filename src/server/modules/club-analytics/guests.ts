import { and, asc, gte, inArray, isNotNull, lt } from 'drizzle-orm';
import type { TileDef } from '../../../shared/analytics-catalog';
import { periodDays, previousRange } from '../../../shared/club-analytics/columns';
import type { DayCoverage } from '../../../shared/club-analytics/coverage';
import { loginKey, phoneKey, rowGuest, type Guests, type KeyPair } from '../../../shared/club-analytics/guest-links';
import { ageBuckets, cohorts, firstVisits, guestBuckets, lastAges, visitsOf, type CohortRow, type GuestFigures, type GuestSession, type Visit } from '../../../shared/club-analytics/guests';
import { localParts } from '../../../shared/club-analytics/hours';
import { addDays } from '../../../shared/dates';
import { reportColumns, type ReportStep } from '../../../shared/report-engine';
import type { GuestsQuery } from '../../../shared/schemas/club-analytics';
import type { Db } from '../../db/client';
import { senetLoad, senetRefills, senetTickets } from '../../db/schema';
import { exportFileName } from '../../http/export-name';
import { buildXlsx, type XlsxCell, type XlsxSheet } from '../../http/xlsx';
import { requireCompany } from '../companies/guard';
import { excelDate, minorToDecimal } from '../operations/journal-export';
import { reportInfo } from '../analytics/report-export';
import { companyGuests, keyRef, type CompanyGuests } from './guest-links';
import { bounds, coverageOf, coverageSummary } from './load';
import { clubDays } from './revenue';
import { clubScope, type ClubScope } from './scope';

/** Гости клубов отчёта за период (§7): визиты за всё время, разложенные по гостям компании (R17). */
export interface ClubGuestsData {
  days: string[];
  cov: DayCoverage[];
  visits: Visit[];
  first: Map<number, string>;
  guests: Guests;
  pairs: KeyPair[];
  /** Сеансов периода без гостя и с общим логином без телефона. */
  unassigned: { noGuest: number; shared: number };
  /** Потрачено (абонементы + списано за сеансы, R21) и пополнено гостями в периоде. */
  spent: Map<number, number>;
  refilled: Map<number, number>;
  /** Местный день первого закрытого сеанса клубов отчёта (R22). */
  dataStart: string | null;
}

/** Выручка и пополнения периода (Σ частей `clubDays`). */
export interface GuestMoney {
  revenue: number | null;
  refills: number | null;
}

export interface GuestRowView {
  ref: string;
  logins: string[];
  masks: string[];
  visits: number;
  visitSec: number;
  spent: number;
  refilled: number;
  firstVisit: string;
  lastVisit: string;
}

/** Плитка «Гостей» — в форме плитки «Обзора» (§7.2). */
export interface GuestTile {
  key: string;
  label: string;
  unit: TileDef['unit'];
  kind: 'sum' | 'avg';
  value: number | null;
  prev: number | null;
  approx: boolean;
  spark: never[];
  available: true;
  note: string | null;
  href: '';
}

type Row = { login: string; phoneHash: string | null };
const add = (m: Map<number, number>, k: number, v: number) => m.set(k, (m.get(k) ?? 0) + v);
const inRange = (at: string, start: string, end: string) => at >= start && at < end;

/** Сумма по гостям строк (абонементы, пополнения): строки без гостя не считаются. */
function byGuest(rows: readonly (Row & { amount: number })[], cg: CompanyGuests, into = new Map<number, number>()): Map<number, number> {
  for (const r of rows) {
    const g = rowGuest(cg.guests, cg.shared, r.login, r.phoneHash);
    if (typeof g === 'number') add(into, g, r.amount);
  }
  return into;
}

type SessionRow = Row & Omit<GuestSession, 'guest'>;

/** Сеансы клубов, разложенные по гостям; сеансы периода без гостя — в счётчики (R19). */
export function assignSessions(rows: readonly SessionRow[], cg: CompanyGuests, start: string, end: string) {
  const sessions: GuestSession[] = [];
  const unassigned = { noGuest: 0, shared: 0 };
  const spent = new Map<number, number>();
  for (const { login, phoneHash, ...s } of rows) {
    const g = rowGuest(cg.guests, cg.shared, login, phoneHash);
    const inPeriod = inRange(s.startAt, start, end);
    if (typeof g === 'number') {
      sessions.push({ ...s, guest: g });
      if (inPeriod) add(spent, g, s.debited);
    } else if (inPeriod) unassigned[g === 'shared' ? 'shared' : 'noGuest'] += 1;
  }
  return { sessions, unassigned, spent };
}

async function sessionRows(db: Db, ids: number[]): Promise<SessionRow[]> {
  return db
    .select({ login: senetLoad.guestLogin, phoneHash: senetLoad.phoneHash, startAt: senetLoad.startAt, endAt: senetLoad.endAt, debited: senetLoad.debited, age: senetLoad.age, zone: senetLoad.zone, workstation: senetLoad.workstation })
    .from(senetLoad)
    .where(and(inArray(senetLoad.officeId, ids), isNotNull(senetLoad.endAt)))
    .orderBy(asc(senetLoad.startAt), asc(senetLoad.id)) as Promise<SessionRow[]>;
}

async function moneyRows(db: Db, ids: number[], start: string, end: string) {
  const [tickets, refills] = await Promise.all([
    db.select({ login: senetTickets.guestLogin, phoneHash: senetTickets.phoneHash, amount: senetTickets.price }).from(senetTickets).where(and(inArray(senetTickets.officeId, ids), gte(senetTickets.at, start), lt(senetTickets.at, end))),
    db.select({ login: senetRefills.guestLogin, phoneHash: senetRefills.phoneHash, amount: senetRefills.amount }).from(senetRefills).where(and(inArray(senetRefills.officeId, ids), gte(senetRefills.at, start), lt(senetRefills.at, end))),
  ]);
  return { tickets, refills };
}

export async function clubGuests(db: Db, tz: string, companyId: number, scope: ClubScope, from: string, to: string, now: string): Promise<ClubGuestsData> {
  const days = periodDays(from, to);
  const { start, end } = bounds(from, to, tz);
  const ids = scope.offices.map((o) => o.id);
  const cg = await companyGuests(db, companyId, now);
  const [rows, money, cov] = await Promise.all([ids.length ? sessionRows(db, ids) : [], ids.length ? moneyRows(db, ids, start, end) : { tickets: [], refills: [] }, coverageOf(db, scope, days, tz)]);
  const { sessions, unassigned, spent } = assignSessions(rows, cg, start, end);
  const visits = visitsOf(sessions);
  return {
    days,
    cov,
    visits,
    first: firstVisits(visits),
    guests: cg.guests,
    pairs: cg.pairs,
    unassigned,
    spent: byGuest(money.tickets, cg, spent),
    refilled: byGuest(money.refills, cg),
    dataStart: rows[0] ? localParts(rows[0].startAt, tz).day : null,
  };
}

const ratio = (a: number | null, b: number) => (a === null || b === 0 ? null : a / b);
const dmy = (day: string) => day.split('-').reverse().join('.');

/** Полоса первых 30 дней данных (§7.2): период пересекает `[начало данных, +29 дней]`. */
export function firstDaysNote(dataStart: string | null, from: string, to: string): string | null {
  if (!dataStart || to < dataStart || from > addDays(dataStart, 29)) return null;
  return `Данные Senet начинаются ${dmy(dataStart)} — гости этих дней считаются новыми`;
}

/** Цифры плиток (§7.2): что плитка берёт из цифр периода и денег. */
const TILES: { key: string; label: string; unit: TileDef['unit']; kind: GuestTile['kind']; note?: string; value: (f: GuestFigures, m: GuestMoney) => number | null }[] = [
  { key: 'guests', label: 'Уникальных гостей', unit: 'number', kind: 'sum', value: (f) => f.guests },
  { key: 'newGuests', label: 'Новых', unit: 'number', kind: 'sum', value: (f) => f.newGuests },
  { key: 'returning', label: 'Вернувшихся', unit: 'number', kind: 'sum', value: (f) => f.returning },
  { key: 'visitsPerGuest', label: 'Визитов на гостя', unit: 'number', kind: 'avg', value: (f) => ratio(f.visits, f.guests) },
  { key: 'hoursPerGuest', label: 'Часов на гостя', unit: 'duration', kind: 'avg', value: (f) => ratio(f.visitSec, f.guests) },
  { key: 'revenuePerGuest', label: 'Потратил на гостя', unit: 'money', kind: 'avg', note: 'выручка / гостей', value: (f, m) => ratio(m.revenue, f.guests) },
  { key: 'refillsPerGuest', label: 'Пополнений на гостя', unit: 'money', kind: 'avg', value: (f, m) => ratio(m.refills, f.guests) },
];

const periodFigures = (d: ClubGuestsData, tz: string) => guestBuckets(d.visits, d.first, [{ from: d.days[0]!, to: d.days.at(-1)! }], tz)[0]!;

/** Гости таблицы (§7.4): логины пар гостя по алфавиту, различные маски его телефонов. */
function namesOf(keys: readonly string[], pairs: readonly KeyPair[]) {
  const set = new Set(keys);
  const logins = new Set(pairs.filter((p) => set.has(loginKey(p.login) ?? '')).map((p) => p.login.trim()));
  const masks = new Set(pairs.filter((p) => set.has(phoneKey(p.phoneHash) ?? '') && p.phoneMask).map((p) => p.phoneMask!));
  return { logins: [...logins].sort((a, b) => a.localeCompare(b, 'ru')), masks: [...masks].sort() };
}

const TOP = 50;

/** Топ-50 гостей периода по потраченному (§7.4); при равенстве — больше визитов, затем по ссылке. */
export function topGuests(d: ClubGuestsData, period: readonly Visit[]): GuestRowView[] {
  const by = new Map<number, Visit[]>();
  for (const v of period) by.set(v.guest, [...(by.get(v.guest) ?? []), v]);
  const rows = [...by].map(([g, vs]) => ({
    ref: keyRef(d.guests.keys[g]![0]!),
    ...namesOf(d.guests.keys[g]!, d.pairs),
    visits: vs.length,
    visitSec: vs.reduce((t, v) => t + (Date.parse(v.endAt) - Date.parse(v.startAt)) / 1000, 0),
    spent: d.spent.get(g) ?? 0,
    refilled: d.refilled.get(g) ?? 0,
    firstVisit: d.first.get(g)!,
    lastVisit: vs.at(-1)!.startAt,
  }));
  return rows.sort((a, b) => b.spent - a.spent || b.visits - a.visits || (a.ref < b.ref ? -1 : 1)).slice(0, TOP);
}

/** Месяцы `YYYY-MM` от месяца `from` до месяца `to`. */
function monthsOf(from: string, to: string): string[] {
  const out: string[] = [];
  for (let m = from.slice(0, 7); m <= to.slice(0, 7); ) {
    out.push(m);
    const [y, mm] = m.split('-').map(Number) as [number, number];
    m = mm === 12 ? `${y + 1}-01` : `${y}-${String(mm + 1).padStart(2, '0')}`;
  }
  return out;
}

/** Колонка с хотя бы одним днём с данными. */
const hasData = (days: readonly string[], cov: readonly DayCoverage[], c: { from: string; to: string }) => days.some((d, i) => d >= c.from && d <= c.to && cov[i] !== 'none');

/** Ответ «Гостей» (§7.2–§7.4) по данным периода и прошлого периода. */
export function buildGuestsReport(cur: ClubGuestsData, prev: ClubGuestsData | null, money: { cur: GuestMoney; prev: GuestMoney | null }, q: Pick<GuestsQuery, 'from' | 'to' | 'step'>, ctx: { approx: boolean; tz: string; now: string }) {
  const { tz } = ctx;
  const columns = reportColumns(q.from, q.to, q.step);
  const figures = guestBuckets(cur.visits, cur.first, columns, tz);
  const col = (pick: (f: GuestFigures) => number) => figures.map((f, i) => (hasData(cur.days, cur.cov, columns[i]!) ? pick(f) : null));
  const total = periodFigures(cur, tz);
  const prevTotal = prev ? periodFigures(prev, tz) : null;
  const period = cur.visits.filter((v) => localParts(v.startAt, tz).day >= q.from && localParts(v.startAt, tz).day <= q.to);
  const summary = coverageSummary(cur.days, cur.cov);
  const tiles: GuestTile[] = TILES.map((t) => ({
    key: t.key,
    label: t.label,
    unit: t.unit,
    kind: t.kind,
    value: t.value(total, money.cur),
    prev: prevTotal && money.prev ? t.value(prevTotal, money.prev) : null,
    approx: ctx.approx,
    spark: [],
    available: true,
    note: t.note ?? null,
    href: '',
  }));
  return {
    tiles,
    columns,
    series: [
      { id: 'new', label: 'Новые', values: col((f) => f.newGuests) },
      { id: 'returning', label: 'Вернувшиеся', values: col((f) => f.returning) },
    ],
    top: topGuests(cur, period),
    ages: ageBuckets([...lastAges(period).values()]),
    cohorts: cohorts(cur.visits, cur.first, monthsOf(q.from, q.to), localParts(ctx.now, tz).day.slice(0, 7), tz) as CohortRow[],
    unassigned: cur.unassigned,
    firstDaysNote: firstDaysNote(cur.dataStart, q.from, q.to),
    coverage: summary,
    prevCoverage: prev ? { days: prev.days.length, withData: prev.cov.filter((c) => c !== 'none').length } : null,
    meta: { from: q.from, to: q.to, step: q.step as ReportStep, empty: summary.withData === 0 },
  };
}

export type GuestsReport = ReturnType<typeof buildGuestsReport>;

/** Δ сумм с «≈» (§2.2): в периоде есть прошедшие дни без данных или прошлый период неполон. */
export function guestsApprox(cur: ClubGuestsData, prev: ClubGuestsData | null, today: string): boolean {
  return cur.days.some((d, i) => d <= today && cur.cov[i] === 'none') || (prev !== null && prev.cov.includes('none'));
}

const num = (v: number, decimals: number): XlsxCell => ({ kind: 'number', value: v.toFixed(decimals), decimals });
const money = (v: number): XlsxCell => ({ kind: 'number', value: minorToDecimal(Math.round(v), 2), decimals: 2 });

/** Excel «Гостей» (§7.4): постоянные гости с масками и когорты; хешей и ключей нет. */
export function guestsSheets(data: Pick<GuestsReport, 'top' | 'cohorts'>, q: GuestsQuery, tz: string): XlsxSheet[] {
  const info = reportInfo({ title: 'Гости', from: q.from, to: q.to, filters: q.project ? 'один клуб' : 'все клубы' });
  const preamble = info.map((line): XlsxCell[] => [{ kind: 'text', value: line }]);
  const day = (iso: string): XlsxCell => ({ kind: 'date', value: excelDate(localParts(iso, tz).day) });
  const head = ['Логины', 'Маски телефонов', 'Визитов', 'Часов', 'Потратил', 'Пополнил', 'Первый визит', 'Последний визит'];
  return [
    {
      name: 'Постоянные гости',
      preamble,
      columns: head.map((header, i) => ({ header, width: i < 2 ? 30 : 16 })),
      rows: data.top.map((g) => [
        { kind: 'text', value: g.logins.join(', ') },
        { kind: 'text', value: g.masks.join(', ') },
        num(g.visits, 0),
        num(g.visitSec / 3600, 2),
        money(g.spent),
        money(g.refilled),
        day(g.firstVisit),
        day(g.lastVisit),
      ]),
    },
    {
      name: 'Когорты',
      preamble,
      columns: [{ header: 'Месяц первого визита', width: 20 }, { header: 'Гостей', width: 10 }, ...Array.from({ length: 7 }, (_, k) => ({ header: `${k} мес., %`, width: 12 }))],
      rows: data.cohorts.map((c) => [{ kind: 'text', value: c.month }, num(c.size, 0), ...c.shares.map((s) => (s === null ? null : num(s * 100, 2)))]),
    },
  ];
}

const sumOf = (xs: readonly (number | null)[]): number | null => (xs.every((x) => x === null) ? null : xs.reduce<number>((t, x) => t + (x ?? 0), 0));

export function createClubGuests(d: { db: Db; timezone: string; now: () => Date }) {
  const { db, timezone: tz } = d;

  async function moneyOf(scope: ClubScope, from: string, to: string): Promise<GuestMoney> {
    const days = await clubDays(db, tz, scope.offices.map((o) => o.id), from, to);
    return { revenue: sumOf(days.parts.revenue), refills: sumOf(days.parts.refills) };
  }

  const svc = {
    /** «Гости» (§7, §11). */
    async guests(companyId: number, q: GuestsQuery) {
      await requireCompany(db, companyId);
      const scope = await clubScope(db, companyId, q.project);
      const now = d.now().toISOString();
      const p = previousRange(q.from, q.to);
      const [cur, prev, mCur, mPrev] = await Promise.all([
        clubGuests(db, tz, companyId, scope, q.from, q.to, now),
        q.compare ? clubGuests(db, tz, companyId, scope, p.from, p.to, now) : null,
        moneyOf(scope, q.from, q.to),
        q.compare ? moneyOf(scope, p.from, p.to) : null,
      ]);
      const approx = guestsApprox(cur, prev, localParts(now, tz).day);
      return { ...buildGuestsReport(cur, prev, { cur: mCur, prev: mPrev }, q, { approx, tz, now }), freshness: scope.freshness };
    },

    /** Excel: постоянные гости и когорты. */
    async xlsx(companyId: number, q: GuestsQuery) {
      const company = await requireCompany(db, companyId);
      const sheets = guestsSheets(await svc.guests(companyId, q), q, tz);
      return { fileName: exportFileName(company.name, 'Гости', d.now(), tz), data: buildXlsx(sheets, { strings: 'shared' }) };
    },
  };
  return svc;
}

export type ClubGuests = ReturnType<typeof createClubGuests>;
