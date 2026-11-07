/**
 * Визиты и цифры гостей (спецификация «Аналитика клуба», §7.1–§7.3, R20–R24, R27): визиты из закрытых сеансов, гости,
 * новые и вернувшиеся по корзинам дней, возраст, когорты.
 */
import { localParts } from './hours';

/** Перерыв меньше этого — тот же визит (§7.1). */
export const VISIT_GAP_SEC = 1800;

/** Закрытый сеанс с номером гостя (`groupGuests`). */
export interface GuestSession {
  guest: number;
  startAt: string;
  endAt: string;
  debited: number;
  age: number | null;
  zone: string;
  workstation: number | null;
}

export interface Visit {
  guest: number;
  startAt: string;
  endAt: string;
  sessions: GuestSession[];
}

const byStart = (a: { startAt: string }, b: { startAt: string }) => (a.startAt < b.startAt ? -1 : a.startAt > b.startAt ? 1 : 0);
const gapSec = (endAt: string, startAt: string) => (Date.parse(startAt) - Date.parse(endAt)) / 1000;

/** Визиты (R20): сеансы гостя по началу; перерыв меньше `VISIT_GAP_SEC` — тот же визит, конец — наибольший конец. */
export function visitsOf(sessions: readonly GuestSession[]): Visit[] {
  const sorted = [...sessions].sort((a, b) => a.guest - b.guest || byStart(a, b));
  const out: Visit[] = [];
  for (const s of sorted) {
    const cur = out.at(-1);
    if (cur && cur.guest === s.guest && gapSec(cur.endAt, s.startAt) < VISIT_GAP_SEC) {
      cur.sessions.push(s);
      if (s.endAt > cur.endAt) cur.endAt = s.endAt;
    } else out.push({ guest: s.guest, startAt: s.startAt, endAt: s.endAt, sessions: [s] });
  }
  return out;
}

/** Первый визит гостя среди переданных. */
export function firstVisits(visits: readonly Visit[]): Map<number, string> {
  const out = new Map<number, string>();
  for (const v of visits) if (!out.has(v.guest) || v.startAt < out.get(v.guest)!) out.set(v.guest, v.startAt);
  return out;
}

export interface GuestFigures {
  guests: number;
  newGuests: number;
  returning: number;
  visits: number;
  visitSec: number;
}

/** Корзина, в которую попадает день: корзины по возрастанию и не пересекаются; вне корзин — -1. */
function bucketOf(day: string, buckets: readonly { from: string; to: string }[]): number {
  let lo = 0;
  let hi = buckets.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (buckets[mid]!.from <= day) lo = mid + 1;
    else hi = mid - 1;
  }
  return hi >= 0 && day <= buckets[hi]!.to ? hi : -1;
}

/**
 * Цифры корзин — местных дней `[from, to]` включительно (§7.2, R27): гость корзины — с визитом, начатым в ней; новый —
 * его первый визит тоже в корзине; время — длительность визитов от начала до конца.
 */
export function guestBuckets(visits: readonly Visit[], first: ReadonlyMap<number, string>, buckets: readonly { from: string; to: string }[], timeZone: string): GuestFigures[] {
  const acc = buckets.map(() => ({ guests: new Set<number>(), fresh: new Set<number>(), visits: 0, visitSec: 0 }));
  for (const v of visits) {
    const i = bucketOf(localParts(v.startAt, timeZone).day, buckets);
    if (i < 0) continue;
    const a = acc[i]!;
    a.guests.add(v.guest);
    if (localParts(first.get(v.guest) ?? v.startAt, timeZone).day >= buckets[i]!.from) a.fresh.add(v.guest);
    a.visits += 1;
    a.visitSec += (Date.parse(v.endAt) - Date.parse(v.startAt)) / 1000;
  }
  return acc.map((a) => ({ guests: a.guests.size, newGuests: a.fresh.size, returning: a.guests.size - a.fresh.size, visits: a.visits, visitSec: a.visitSec }));
}

/** Визиты и их время по корзинам дня начала (визиты одноразовых чеков, §19 R30). */
export function countVisits(visits: readonly Visit[], buckets: readonly { from: string; to: string }[], timeZone: string): { visits: number; visitSec: number }[] {
  const acc = buckets.map(() => ({ visits: 0, visitSec: 0 }));
  for (const v of visits) {
    const i = bucketOf(localParts(v.startAt, timeZone).day, buckets);
    if (i < 0) continue;
    acc[i]!.visits += 1;
    acc[i]!.visitSec += (Date.parse(v.endAt) - Date.parse(v.startAt)) / 1000;
  }
  return acc;
}

export const AGE_LABELS =['до 14', '14–17', '18–24', '25–34', '35+', 'не указан'] as const;
const AGE_FROM = [0, 14, 18, 25, 35];

const ageIndex = (age: number | null) => (age === null ? AGE_LABELS.length - 1 : AGE_FROM.findLastIndex((f) => age >= f));

/** Доли гостей по возрасту (§7.2). */
export function ageBuckets(ages: readonly (number | null)[]): { label: string; count: number; share: number }[] {
  const counts = AGE_LABELS.map(() => 0);
  for (const a of ages) counts[ageIndex(a)]! += 1;
  return AGE_LABELS.map((label, i) => ({ label, count: counts[i]!, share: ages.length ? counts[i]! / ages.length : 0 }));
}

/** Последний указанный возраст гостя в визитах (R23); не указан — null. */
export function lastAges(visits: readonly Visit[]): Map<number, number | null> {
  const out = new Map<number, { at: string; age: number | null }>();
  for (const s of visits.flatMap((v) => v.sessions)) {
    const cur = out.get(s.guest);
    if (!cur) out.set(s.guest, { at: s.age === null ? '' : s.startAt, age: s.age });
    else if (s.age !== null && s.startAt >= cur.at) out.set(s.guest, { at: s.startAt, age: s.age });
  }
  return new Map([...out].map(([g, v]) => [g, v.age]));
}

export interface CohortRow {
  month: string;
  size: number;
  /** Доля гостей когорты с визитом через 0…6 месяцев; месяц позже текущего — null. */
  shares: (number | null)[];
}

/** Через сколько месяцев следует месяц `YYYY-MM`. */
function addMonths(month: string, k: number): string {
  const [y, m] = month.split('-').map(Number) as [number, number];
  const n = y * 12 + (m - 1) + k;
  return `${Math.floor(n / 12)}-${String((n % 12) + 1).padStart(2, '0')}`;
}

const AFTER = 6;

/** Когорты (§7.3, R24): месяц первого визита × месяцев спустя; визиты — за всё переданное. */
export function cohorts(visits: readonly Visit[], first: ReadonlyMap<number, string>, months: readonly string[], currentMonth: string, timeZone: string): CohortRow[] {
  const monthOf = (at: string) => localParts(at, timeZone).day.slice(0, 7);
  const seen = new Map<number, Set<string>>();
  for (const v of visits) seen.set(v.guest, (seen.get(v.guest) ?? new Set()).add(monthOf(v.startAt)));
  const byCohort = new Map<string, number[]>();
  for (const [g, at] of first) {
    const m = monthOf(at);
    const list = byCohort.get(m);
    if (list) list.push(g);
    else byCohort.set(m, [g]);
  }
  return months.map((month) => {
    const guests = byCohort.get(month) ?? [];
    const shares = Array.from({ length: AFTER + 1 }, (_, k) => {
      const m = addMonths(month, k);
      return guests.length === 0 || m > currentMonth ? null : guests.filter((g) => seen.get(g)?.has(m)).length / guests.length;
    });
    return { month, size: guests.length, shares };
  });
}
