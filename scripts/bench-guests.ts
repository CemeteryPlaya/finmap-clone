/**
 * Замер расчёта «Гостей» на синтетике размера настоящего клуба (АК-3, регрессия скорости на проде).
 * Запуск: npx tsx scripts/bench-guests.ts
 */
import { groupGuests, rowGuest, sharedLogins, type KeyPair } from '../src/shared/club-analytics/guest-links';
import { ageBuckets, cohorts, firstVisits, guestBuckets, lastAges, visitsOf, type GuestSession } from '../src/shared/club-analytics/guests';
import { reportColumns } from '../src/shared/report-engine';

const TZ = 'Asia/Almaty';
const N = Number(process.env.N ?? 150_000);
const GUESTS = Number(process.env.G ?? 8_000);
const start = Date.parse('2025-09-01T00:00:00Z');
const span = 430 * 86_400_000;

let seed = 1;
const r = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);

const t0 = performance.now();
const lap = (label: string, since: number) => console.log(`${label.padEnd(28)} ${(performance.now() - since).toFixed(0)} мс`);

const rows: { login: string; phoneHash: string | null; startAt: string; endAt: string }[] = [];
for (let i = 0; i < N; i++) {
  const g = Math.floor(r() ** 2 * GUESTS);
  const s = start + Math.floor(r() * span);
  rows.push({ login: `Guest${g}`, phoneHash: `h${g}`, startAt: new Date(s).toISOString(), endAt: new Date(s + 3_600_000).toISOString() });
}
const pairs: KeyPair[] = [...new Map(rows.map((x) => [`${x.login}|${x.phoneHash}`, { login: x.login, phoneHash: x.phoneHash, phoneMask: '+7 *** ** 12', lastAt: x.startAt }])).values()];
lap('данные', t0);

let t = performance.now();
const kinds = { shared: sharedLogins(pairs, '2026-08-01T00:00:00Z'), checks: new Set<string>() };
const g = groupGuests(pairs, kinds, []);
lap('groupGuests', t);

t = performance.now();
const sessions: GuestSession[] = rows.map((x) => ({ guest: rowGuest(g, kinds, x.login, x.phoneHash) as number, startAt: x.startAt, endAt: x.endAt, debited: 0, age: 19, zone: 'VIP', workstation: 1 }));
lap('rowGuest × N', t);

t = performance.now();
const visits = visitsOf(sessions);
const first = firstVisits(visits);
lap('visitsOf + firstVisits', t);

t = performance.now();
guestBuckets(visits, first, reportColumns('2026-01-01', '2026-12-31', 'month'), TZ);
lap('guestBuckets по месяцам', t);

t = performance.now();
const days = Array.from({ length: 365 }, (_, i) => new Date(Date.parse('2026-01-01') + i * 86_400_000).toISOString().slice(0, 10));
guestBuckets(visits, first, days.map((d) => ({ from: d, to: d })), TZ);
lap('guestBuckets по дням', t);

t = performance.now();
ageBuckets([...lastAges(visits).values()]);
lap('возраст', t);

t = performance.now();
cohorts(visits, first, ['2026-01', '2026-02', '2026-03', '2026-04', '2026-05', '2026-06', '2026-07', '2026-08', '2026-09', '2026-10', '2026-11', '2026-12'], '2026-11', TZ);
lap('когорты', t);
lap('всего', t0);
