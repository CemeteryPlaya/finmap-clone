import { and, asc, gte, inArray, isNotNull, lt } from 'drizzle-orm';
import { combineCoverage, dayCoverage, type DayCoverage } from '../../../shared/club-analytics/coverage';
import { periodDays, previousRange } from '../../../shared/club-analytics/columns';
import { splitByHour } from '../../../shared/club-analytics/hours';
import { extremeHours, loadColumns, loadHeatmap, loadTotal, occupancy, sumZones, zoneStats, type LoadSession, type Occupancy } from '../../../shared/club-analytics/load';
import { addDays, startOfDayUtc } from '../../../shared/dates';
import { reportColumns, type ReportStep } from '../../../shared/report-engine';
import type { LoadQuery, LoadRowsQuery } from '../../../shared/schemas/club-analytics';
import type { Db } from '../../db/client';
import { senetLoad } from '../../db/schema';
import { exportFileName } from '../../http/export-name';
import { buildXlsx, type XlsxCell, type XlsxSheet } from '../../http/xlsx';
import { requireCompany } from '../companies/guard';
import { minorToDecimal } from '../operations/journal-export';
import { reportInfo } from '../analytics/report-export';
import { loadSpans } from '../senet/store';
import type { CellItem } from './revenue';
import { clubScope, NO_PC_NOTE, pcsOf, type ClubScope } from './scope';
import { zoneSeats } from './zones';

/** Сеанс клуба с полями для списка ячейки карты; `zone` — ключ зоны отчёта (у нескольких клубов — с клубом, R14). */
interface Row extends LoadSession {
  officeId: number;
  zoneName: string;
  guestLogin: string;
  phoneMask: string | null;
}

/** Загрузка клубов за период (§6): дни, покрытие, занятое время по зонам, места. «Обзор» берёт её отсюда. */
export interface ClubLoadData {
  days: string[];
  cov: DayCoverage[];
  occ: Occupancy;
  seats: number;
  /** Подсказка о местах (§6.1, §13) или null. */
  seatsNote: string | null;
  zones: { id: string; label: string; seats: number }[];
  /** Закрытые сеансы, пересекающие период. */
  sessions: Row[];
}

const DAY_MS = 86_400_000;
const bounds = (from: string, to: string, tz: string) => ({ start: startOfDayUtc(from, tz), end: startOfDayUtc(addDays(to, 1), tz) });
const mismatch = (zones: number, pcs: number) => `По данным Senet в зонах ${zones} ПК, в проекте — ${pcs}. Проверьте «Количество ПК» или зоны`;

/** Закрытые сеансы клубов, пересекающие `[start, end)`: начатые не раньше чем за 24 ч до начала (R12). */
async function sessionsOf(db: Db, scope: ClubScope, start: string, end: string): Promise<Row[]> {
  const ids = scope.offices.map((o) => o.id);
  if (!ids.length) return [];
  const since = new Date(Date.parse(start) - DAY_MS).toISOString();
  const rows = await db
    .select({ officeId: senetLoad.officeId, startAt: senetLoad.startAt, endAt: senetLoad.endAt, zone: senetLoad.zone, workstation: senetLoad.workstation, debited: senetLoad.debited, guestLogin: senetLoad.guestLogin, phoneMask: senetLoad.phoneMask })
    .from(senetLoad)
    .where(and(inArray(senetLoad.officeId, ids), gte(senetLoad.startAt, since), lt(senetLoad.startAt, end), isNotNull(senetLoad.endAt)))
    .orderBy(asc(senetLoad.startAt), asc(senetLoad.id));
  const many = scope.offices.length > 1;
  return rows
    .filter((r) => r.endAt! > start)
    .map((r) => ({ ...r, zoneName: r.zone, zone: zoneKey(many, r.officeId, r.zone) }));
}

const zoneKey = (many: boolean, officeId: number, zone: string) => (many ? `${officeId}:${zone}` : zone);

/** Покрытие дней отчётом `load`: у «Все клубы» день полон, только если полон у каждого клуба (R1). */
async function coverageOf(db: Db, scope: ClubScope, days: readonly string[], tz: string): Promise<DayCoverage[]> {
  const ids = scope.offices.map((o) => o.id);
  if (!ids.length) return days.map(() => 'none');
  const { start, end } = bounds(days[0]!, days.at(-1)!, tz);
  const spans = await loadSpans(db, ids, ['load'], start, end);
  return combineCoverage(ids.map((id) => dayCoverage(spans.get(id)!.get('load')!, days, tz)));
}

/** Зоны с сеансами в периоде, которых нет в зонах за 30 дней: мест — разных мест в сеансах периода. */
export function periodZones(sessions: readonly Row[], known: ReadonlySet<string>, label: (r: Row) => string) {
  const seats = new Map<string, { label: string; ws: Set<number | null> }>();
  for (const r of sessions.filter((s) => !known.has(s.zone))) {
    const z = seats.get(r.zone) ?? { label: label(r), ws: new Set() };
    z.ws.add(r.workstation);
    seats.set(r.zone, z);
  }
  return [...seats].map(([id, z]) => ({ id, label: z.label, seats: z.ws.size }));
}

/** Зоны отчёта с местами (своё число или по данным) и итог мест (R9). */
async function seatsOf(db: Db, scope: ClubScope, sessions: readonly Row[], now: string) {
  const many = scope.offices.length > 1;
  const club = new Map(scope.projects.map((p) => [p.id, p.name]));
  const bySeats = await zoneSeats(
    db,
    scope.offices.map((o) => o.id),
    now,
  );
  const zones = scope.offices.flatMap((o) =>
    [...bySeats.get(o.id)!].map(([zone, seats]) => ({ id: zoneKey(many, o.id, zone), label: many ? `${club.get(o.projectId)} · ${zone}` : zone, seats })),
  );
  const office = new Map(scope.offices.map((o) => [o.id, o.projectId]));
  zones.push(...periodZones(sessions, new Set(zones.map((z) => z.id)), (r) => (many ? `${club.get(office.get(r.officeId)!)} · ${r.zoneName}` : r.zoneName)));
  const zonesTotal = zones.reduce((t, z) => t + z.seats, 0);
  const pcs = pcsOf(scope);
  if (pcs === 0) return { zones, seats: zonesTotal, seatsNote: scope.offices.length ? NO_PC_NOTE : null };
  return { zones, seats: pcs, seatsNote: zones.length && zonesTotal !== pcs ? mismatch(zonesTotal, pcs) : null };
}

export async function clubLoad(db: Db, tz: string, scope: ClubScope, from: string, to: string, now: string): Promise<ClubLoadData> {
  const days = periodDays(from, to);
  const { start, end } = bounds(from, to, tz);
  const [sessions, cov] = await Promise.all([sessionsOf(db, scope, start, end), coverageOf(db, scope, days, tz)]);
  return { days, cov, occ: occupancy(sessions, days, tz), sessions, ...(await seatsOf(db, scope, sessions, now)) };
}

/** Сеансы, пересекающие час `hour` дня недели `weekday` в днях периода (R15). */
function inCell(sessions: readonly Row[], days: ReadonlySet<string>, weekday: number, hour: number, tz: string): Row[] {
  return sessions.filter((s) => splitByHour(s.startAt, s.endAt!, tz).some((p) => p.weekday === weekday && p.hour === hour && days.has(p.day)));
}

const toItem = (s: Row): CellItem => ({
  at: s.startAt,
  kind: 'session',
  label: [s.zoneName, s.workstation === null ? '' : `ПК ${s.workstation}`].filter(Boolean).join(' · '),
  amount: s.debited,
  workstation: s.workstation,
  guest: s.guestLogin,
  phoneMask: s.phoneMask,
});

const PAGE = 50;
const WEEKDAYS = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'];

type LoadReport = Awaited<ReturnType<ClubLoad['load']>>;

const percentCell = (v: number | null): XlsxCell => (v === null ? null : { kind: 'number', value: (v * 100).toFixed(2), decimals: 2 });
const numberCell = (v: number | null, decimals: number): XlsxCell => (v === null ? null : { kind: 'number', value: v.toFixed(decimals), decimals });
const moneyCell = (v: number | null): XlsxCell => (v === null ? null : { kind: 'number', value: minorToDecimal(Math.round(v), 2), decimals: 2 });

/** Excel «Загрузки» (§6.3): лист зон и лист карты «по часам». */
export function loadSheets(data: LoadReport, q: LoadQuery): XlsxSheet[] {
  const info = reportInfo({ title: 'Загрузка', from: q.from, to: q.to, filters: q.project ? 'один клуб' : 'все клубы' });
  const preamble = info.map((line): XlsxCell[] => [{ kind: 'text', value: line }]);
  const head = ['Зона', 'Мест', 'Загрузка, %', 'Сеансов', 'Сеансов на место в день', 'Средняя длительность, мин', 'Часов всего', 'Списано за часы', 'Списано на место в час'];
  return [
    {
      name: 'Зоны',
      preamble,
      columns: head.map((header, i) => ({ header, width: i === 0 ? 30 : 16 })),
      rows: data.zones.map((z) => [
        { kind: 'text', value: z.label },
        numberCell(z.seats, 0),
        percentCell(z.load),
        numberCell(z.sessions, 0),
        numberCell(z.sessionsPerSeatDay, 2),
        numberCell(z.avgSessionSec === null ? null : z.avgSessionSec / 60, 0),
        numberCell(z.hours, 2),
        moneyCell(z.debited),
        moneyCell(z.debitedPerSeatHour),
      ]),
    },
    {
      name: 'По часам',
      preamble,
      columns: [{ header: 'День', width: 8 }, ...Array.from({ length: 24 }, (_, h) => ({ header: String(h), width: 7 }))],
      rows: data.heatmap.map((row, w) => [{ kind: 'text', value: WEEKDAYS[w]! }, ...row.map(percentCell)]),
    },
  ];
}

const coverageSummary = (days: readonly string[], cov: readonly DayCoverage[]) => ({
  days: days.length,
  withData: cov.filter((c) => c !== 'none').length,
  partial: cov.filter((c) => c === 'partial').length,
  missingDays: days.filter((_, i) => cov[i] === 'none'),
});

/** Ответ «Загрузки» (§6.3) по данным периода и прошлого периода; `start`/`end` — границы периода (сеансы, начатые в нём). */
export function buildLoadReport(cur: ClubLoadData, prev: ClubLoadData | null, q: Pick<LoadQuery, 'from' | 'to' | 'step' | 'by'>, start: string, end: string) {
  const columns = reportColumns(q.from, q.to, q.step);
  const all = sumZones(cur.occ, cur.days.length);
  const zoneOcc = (id: string) => cur.occ.get(id) ?? cur.days.map(() => Array.from({ length: 24 }, () => 0));
  const fullDays = cur.cov.filter((c) => c === 'full').length;
  const started = cur.sessions.filter((s) => s.startAt >= start && s.startAt < end);
  const heatmap = loadHeatmap(all, cur.seats, cur.days, cur.cov);
  const summary = coverageSummary(cur.days, cur.cov);
  return {
    columns,
    series:
      q.by === 'zones'
        ? cur.zones.map((z) => ({ id: z.id, label: z.label, values: loadColumns(zoneOcc(z.id), z.seats, cur.days, cur.cov, columns) }))
        : [{ id: 'all', label: 'Все зоны', values: loadColumns(all, cur.seats, cur.days, cur.cov, columns) }],
    total: loadTotal(all, cur.seats, cur.cov),
    prevTotal: prev ? loadTotal(sumZones(prev.occ, prev.days.length), prev.seats, prev.cov) : null,
    heatmap,
    idle: extremeHours(heatmap, 5, 'min'),
    zones: [
      ...cur.zones.map((z) => ({ id: z.id, label: z.label, seats: z.seats, load: loadTotal(zoneOcc(z.id), z.seats, cur.cov), ...zoneStats(started.filter((s) => s.zone === z.id), z.seats, fullDays) })),
      { id: 'all', label: 'Все зоны', seats: cur.seats, load: loadTotal(all, cur.seats, cur.cov), ...zoneStats(started, cur.seats, fullDays) },
    ],
    seats: { total: cur.seats, zones: cur.zones.map((z) => ({ label: z.label, seats: z.seats })), note: cur.seatsNote },
    coverage: summary,
    prevCoverage: prev ? { days: prev.days.length, withData: prev.cov.filter((c) => c !== 'none').length } : null,
    meta: { from: q.from, to: q.to, step: q.step as ReportStep, by: q.by, empty: summary.withData === 0, noZones: summary.withData > 0 && started.length === 0 },
  };
}

export function createClubLoad(d: { db: Db; timezone: string; now: () => Date }) {
  const { db, timezone: tz } = d;
  const svc = {
    /** «Загрузка» (§6, §11). */
    async load(companyId: number, q: LoadQuery) {
      await requireCompany(db, companyId);
      const scope = await clubScope(db, companyId, q.project);
      const now = d.now().toISOString();
      const prevRange = previousRange(q.from, q.to);
      const [cur, prev] = await Promise.all([clubLoad(db, tz, scope, q.from, q.to, now), q.compare ? clubLoad(db, tz, scope, prevRange.from, prevRange.to, now) : null]);
      const { start, end } = bounds(q.from, q.to, tz);
      return { ...buildLoadReport(cur, prev, q, start, end), freshness: scope.freshness };
    },

    /** Сеансы ячейки карты (R15): по началу, страницы по 50. */
    async rows(companyId: number, q: LoadRowsQuery) {
      await requireCompany(db, companyId);
      const scope = await clubScope(db, companyId, q.project);
      const data = await clubLoad(db, tz, scope, q.from, q.to, d.now().toISOString());
      const items = inCell(data.sessions, new Set(data.days), q.weekday, q.hour, tz).map(toItem);
      const next = q.cursor + PAGE;
      return { items: items.slice(q.cursor, next), nextCursor: next < items.length ? String(next) : null };
    },

    /** Excel: зоны и карта, как на экране. */
    async xlsx(companyId: number, q: LoadQuery) {
      const company = await requireCompany(db, companyId);
      const sheets = loadSheets(await svc.load(companyId, q), q);
      return { fileName: exportFileName(company.name, 'Загрузка', d.now(), tz), data: buildXlsx(sheets, { strings: 'shared' }) };
    },
  };
  return svc;
}

export type ClubLoad = ReturnType<typeof createClubLoad>;
