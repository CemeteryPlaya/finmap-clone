import type { DayCoverage } from './coverage';
import { localParts, splitByHour } from './hours';

/**
 * Строки Senet для выручки клуба (спецификация «Аналитика клуба», §5.1, §16 R6). Суммы — тиыны; `qty` — ×1000, у чека
 * времени пусто. Деньги идут так: касса продаёт чеки на время и товары → чек зачисляется на баланс (пополнение) → с
 * баланса гость покупает абонемент (`tickets`) или платит поминутно за сеанс (`load.debited`, «Аренда ПК»).
 */
export interface RevenueInput {
  load: { startAt: string; endAt: string | null; debited: number }[];
  tickets: { at: string; price: number }[];
  sold: { at: string; qty: number | null; amount: number; refund: boolean }[];
  refills: { at: string; amount: number; accountType: string }[];
  transactions: { at: string; kind: 'sell' | 'refund'; amount: number; payment: string }[];
}

/**
 * Части таблицы §5.1 (R6): часы — абонементы и аренда ПК, выручка — часы и бар; справочно — пополнения балансов (оба типа:
 * Check и General — зачисленные чеки на время), деньги в кассу, разница.
 */
export type RevenuePart = 'packages' | 'rent' | 'hours' | 'bar' | 'revenue' | 'refills' | 'desk' | 'diff';
export const REVENUE_PARTS: readonly RevenuePart[] = ['packages', 'rent', 'hours', 'bar', 'revenue', 'refills', 'desk', 'diff'];

/** Сумма по дням периода; строка вне дней не учитывается. */
function byDay<T>(rows: readonly T[], days: readonly string[], timeZone: string, at: (r: T) => string, amount: (r: T) => number): number[] {
  const index = new Map(days.map((d, i) => [d, i]));
  const out = days.map(() => 0);
  for (const r of rows) {
    const i = index.get(localParts(at(r), timeZone).day);
    if (i !== undefined) out[i]! += amount(r);
  }
  return out;
}

const signed = (r: { refund: boolean; amount: number }) => (r.refund ? -r.amount : r.amount);
const deskAmount = (t: RevenueInput['transactions'][number]) => (t.kind === 'refund' ? -t.amount : t.amount);

/** Части выручки по дням (§5.1, R6): абонемент — в день покупки, аренда ПК — в день начала сеанса, бар — товары нетто. */
export function revenueByDay(i: RevenueInput, days: readonly string[], timeZone: string): Record<RevenuePart, number[]> {
  const packages = byDay(i.tickets, days, timeZone, (r) => r.at, (r) => r.price);
  const rent = byDay(i.load, days, timeZone, (r) => r.startAt, (r) => r.debited);
  const hours = packages.map((p, d) => p + rent[d]!);
  const bar = byDay(
    i.sold.filter((s) => s.qty !== null),
    days,
    timeZone,
    (r) => r.at,
    signed,
  );
  const refills = byDay(i.refills, days, timeZone, (r) => r.at, (r) => r.amount);
  const desk = byDay(i.transactions, days, timeZone, (r) => r.at, deskAmount);
  const revenue = hours.map((h, d) => h + bar[d]!);
  return { packages, rent, hours, bar, revenue, refills, desk, diff: desk.map((x, d) => x - revenue[d]!) };
}

/** Деньги в кассу по способу оплаты (§5.2) — значение `payment` как есть, в порядке первого появления. */
export function deskByPayment(tx: RevenueInput['transactions'], days: readonly string[], timeZone: string): Map<string, number[]> {
  const out = new Map<string, number[]>();
  for (const payment of new Set(tx.map((t) => t.payment))) {
    out.set(
      payment,
      byDay(
        tx.filter((t) => t.payment === payment),
        days,
        timeZone,
        (r) => r.at,
        deskAmount,
      ),
    );
  }
  return out;
}

/**
 * Карта «день недели × час» (§5.3): средняя выручка часа по дням с полными данными. Списание сеанса — по часам сеанса
 * пропорционально времени, продажа бара — в свой час. Дня недели без полных дней — null.
 */
export function revenueHeatmap(i: RevenueInput, days: readonly string[], cov: readonly DayCoverage[], timeZone: string): (number | null)[][] {
  const full = new Set(days.filter((_, d) => cov[d] === 'full'));
  const sums = heatSums(i, full, timeZone);
  const weekdays = Array.from({ length: 7 }, () => 0);
  for (const day of full) weekdays[localParts(`${day}T12:00:00.000Z`, 'UTC').weekday]!++;
  return sums.map((row, w) => (weekdays[w] ? row.map((v) => Math.round(v / weekdays[w]!)) : row.map(() => null)));
}

/** Суммы «день недели × час» по полным дням: сеанс без конца (идёт) не учитывается. */
function heatSums(i: RevenueInput, full: ReadonlySet<string>, timeZone: string): number[][] {
  const sums = Array.from({ length: 7 }, () => Array.from({ length: 24 }, () => 0));
  const add = (p: { day: string; weekday: number; hour: number }, v: number) => {
    if (full.has(p.day)) sums[p.weekday]![p.hour]! += v;
  };
  for (const s of i.load.filter((x) => x.endAt !== null)) {
    const parts = splitByHour(s.startAt, s.endAt!, timeZone);
    const total = parts.reduce((t, p) => t + p.seconds, 0);
    for (const p of parts) add(p, (s.debited * p.seconds) / total);
  }
  for (const s of i.sold.filter((x) => x.qty !== null)) add(localParts(s.at, timeZone), signed(s));
  for (const t of i.tickets) add(localParts(t.at, timeZone), t.price);
  return sums;
}
