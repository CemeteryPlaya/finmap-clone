import type { ReportColumn } from '../report-engine';
import { mergeSpans, type DayCoverage, type Span } from './coverage';
import { localParts, splitByHour } from './hours';

/**
 * Загрузка ПК (спецификация «Аналитика клуба», §6.2; решения R10–R11): занятое время мест по дням и часам, средние по
 * полным дням, карта «день недели × час», крайние часы, итоги зоны.
 */

/** Сеанс Senet (`senet_load`): без конца — идёт, не учитывается. */
export interface LoadSession {
  startAt: string;
  endAt: string | null;
  zone: string;
  workstation: number | null;
  debited: number;
}

/** Занятые секунды: зона → [индекс дня периода][час 0–23]. */
export type Occupancy = Map<string, number[][]>;

const DAY_SEC = 86_400;
const HOUR_SEC = 3_600;
const grid = (days: number) => Array.from({ length: days }, () => Array.from({ length: 24 }, () => 0));

/** Отрезки мест: наложенные сеансы одного места сливаются; сеанс без места — сам по себе (R11). */
function seatSpans(sessions: readonly LoadSession[]): Map<string, Span[]> {
  const bySeat = new Map<string, Span[]>();
  sessions.forEach((x, i) => {
    if (x.endAt === null || x.endAt <= x.startAt) return;
    const key = x.workstation === null ? `${x.zone}\u0000#${i}` : `${x.zone}\u0000${x.workstation}`;
    bySeat.set(key, [...(bySeat.get(key) ?? []), { from: x.startAt, to: x.endAt }]);
  });
  return bySeat;
}

/** Занятые место-секунды по зонам, дням периода и часам (§6.2); часы вне `days` отбрасываются. */
export function occupancy(sessions: readonly LoadSession[], days: readonly string[], timeZone: string): Occupancy {
  const index = new Map(days.map((d, i) => [d, i]));
  const occ: Occupancy = new Map();
  for (const [key, spans] of seatSpans(sessions)) {
    const zone = key.slice(0, key.indexOf('\u0000'));
    const g = occ.get(zone) ?? grid(days.length);
    occ.set(zone, g);
    for (const span of mergeSpans(spans)) {
      for (const part of splitByHour(span.from, span.to, timeZone)) {
        const d = index.get(part.day);
        if (d !== undefined) g[d]![part.hour]! += part.seconds;
      }
    }
  }
  return occ;
}

/** Все зоны вместе. */
export function sumZones(occ: Occupancy, days: number): number[][] {
  const out = grid(days);
  for (const g of occ.values()) g.forEach((row, d) => row.forEach((v, h) => (out[d]![h]! += v)));
  return out;
}

const daySum = (row: readonly number[]) => row.reduce((a, b) => a + b, 0);
/** Доля занятого: место-секунды / (мест × секунд); нет мест или времени — null. */
const share = (busy: number, seats: number, seconds: number) => (seats > 0 && seconds > 0 ? busy / (seats * seconds) : null);

/** Загрузка за период: по полным дням (R10). */
export function loadTotal(occ: readonly (readonly number[])[], seats: number, cov: readonly DayCoverage[]): number | null {
  let busy = 0;
  let full = 0;
  occ.forEach((row, d) => {
    if (cov[d] !== 'full') return;
    busy += daySum(row);
    full++;
  });
  return share(busy, seats, full * DAY_SEC);
}

/** Загрузка каждого дня; неполный день — null. */
export function loadByDay(occ: readonly (readonly number[])[], seats: number, cov: readonly DayCoverage[]): (number | null)[] {
  return occ.map((row, d) => (cov[d] === 'full' ? share(daySum(row), seats, DAY_SEC) : null));
}

/** Загрузка по колонкам шага: полные дни колонки; без них — null. */
export function loadColumns(occ: readonly (readonly number[])[], seats: number, days: readonly string[], cov: readonly DayCoverage[], columns: readonly ReportColumn[]): (number | null)[] {
  return columns.map((c) => {
    const inCol = days.flatMap((day, d) => (day >= c.from && day <= c.to ? [d] : []));
    return loadTotal(
      inCol.map((d) => occ[d]!),
      seats,
      inCol.map((d) => cov[d]!),
    );
  });
}

/** Карта `[день недели][час]` (0 = Пн): средняя загрузка часа по полным дням этого дня недели. */
export function loadHeatmap(occ: readonly (readonly number[])[], seats: number, days: readonly string[], cov: readonly DayCoverage[]): (number | null)[][] {
  const busy = grid(7);
  const count = Array.from({ length: 7 }, () => 0);
  days.forEach((day, d) => {
    if (cov[d] !== 'full') return;
    const w = localParts(`${day}T12:00:00.000Z`, 'UTC').weekday;
    count[w]!++;
    occ[d]!.forEach((v, h) => (busy[w]![h]! += v));
  });
  return busy.map((row, w) => row.map((v) => share(v, seats, count[w]! * HOUR_SEC)));
}

export interface HourCell {
  weekday: number;
  hour: number;
  value: number;
}

/** `n` часов недели с наибольшей (`max`) или наименьшей (`min`) загрузкой; равные — раньше день недели, затем час. */
export function extremeHours(map: readonly (readonly (number | null)[])[], n: number, order: 'max' | 'min'): HourCell[] {
  const cells = map.flatMap((row, weekday) => row.flatMap((value, hour) => (value === null ? [] : [{ weekday, hour, value }])));
  const sign = order === 'max' ? -1 : 1;
  return cells.sort((a, b) => sign * (a.value - b.value) || a.weekday - b.weekday || a.hour - b.hour).slice(0, n);
}

export interface ZoneStats {
  sessions: number;
  sessionsPerSeatDay: number | null;
  avgSessionSec: number | null;
  hours: number;
  debited: number;
  debitedPerSeatHour: number | null;
}

/** Итоги зоны (§6.3): закрытые сеансы; «на место в день» и «на место в час» — по полным дням. */
export function zoneStats(sessions: readonly LoadSession[], seats: number, fullDays: number): ZoneStats {
  const closed = sessions.filter((x) => x.endAt !== null);
  const seconds = closed.reduce((t, x) => t + (Date.parse(x.endAt!) - Date.parse(x.startAt)) / 1000, 0);
  const debited = closed.reduce((t, x) => t + x.debited, 0);
  const per = (v: number, units: number) => (units > 0 ? v / units : null);
  return {
    sessions: closed.length,
    sessionsPerSeatDay: per(closed.length, seats * fullDays),
    avgSessionSec: per(seconds, closed.length),
    hours: seconds / HOUR_SEC,
    debited,
    debitedPerSeatHour: per(debited, seats * fullDays * 24),
  };
}
