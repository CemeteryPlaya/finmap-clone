import { addDays } from '../dates';
import type { ReportColumn } from '../report-engine';
import type { DayCoverage } from './coverage';

/** Даты периода `[from; to]` включительно. */
export function periodDays(from: string, to: string): string[] {
  const days: string[] = [];
  for (let d = from; d <= to; d = addDays(d, 1)) days.push(d);
  return days;
}

const lastOfMonth = (y: number, m: number) => new Date(Date.UTC(y, m, 0)).getUTCDate();
const ymd = (y: number, m: number, d: number) => `${String(y).padStart(4, '0')}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;

/** Дата на `months` месяцев раньше; числа, которого нет в том месяце, — последний день месяца. */
function monthsBack(date: string, months: number): string {
  const [y, m, d] = date.split('-').map(Number) as [number, number, number];
  const total = y * 12 + (m - 1) - months;
  const ty = Math.floor(total / 12);
  const tm = (total % 12) + 1;
  return ymd(ty, tm, Math.min(d, lastOfMonth(ty, tm)));
}

function endOfMonth(date: string): string {
  const [y, m] = date.split('-').map(Number) as [number, number];
  return ymd(y, m, lastOfMonth(y, m));
}

/** Число целых календарных месяцев периода: с 1-го числа по последний день месяца; иначе null. */
function wholeMonths(from: string, to: string): number | null {
  const [fy, fm, fd] = from.split('-').map(Number) as [number, number, number];
  const [ty, tm, td] = to.split('-').map(Number) as [number, number, number];
  if (fd !== 1 || td !== lastOfMonth(ty, tm)) return null;
  return (ty - fy) * 12 + (tm - fm) + 1;
}

/**
 * Прошлый период (§2.2 спецификации «Аналитика клуба», R43): у целых месяцев (месяц, квартал, год) — те же месяцы раньше
 * по календарю, у остальных — той же длины сразу перед текущим. У идущего периода (сегодня внутри него) прошлый
 * обрезается к тому же дню: к тому же числу у месяцев, к тому же числу дней у остальных — чтобы не сравнивать часть
 * периода с целым.
 */
export function previousRange(from: string, to: string, today: string): { from: string; to: string } {
  const months = wholeMonths(from, to);
  const running = from <= today && today < to;
  if (months !== null) {
    // конец — последним днём того месяца, а не тем же числом (31 марта ← 30 апреля)
    const prev = { from: monthsBack(from, months), to: endOfMonth(monthsBack(to, months)) };
    const cut = monthsBack(today, months);
    return running && cut < prev.to ? { from: prev.from, to: cut } : prev;
  }
  const length = periodDays(from, to).length;
  const prev = { from: addDays(from, -length), to: addDays(from, -1) };
  return running ? { from: prev.from, to: addDays(prev.from, periodDays(from, today).length - 1) } : prev;
}

/**
 * Суммы дней по колонкам шага (§3.3): дни без данных не входят; колонка без единого дня с данными — null.
 * `withData` и `total` — дней с данными и всего дней колонки («данные не за все дни (N из M)»).
 */
export function sumColumns(
  byDay: readonly number[],
  days: readonly string[],
  columns: readonly ReportColumn[],
  cov: readonly DayCoverage[],
): { values: (number | null)[]; withData: number[]; total: number[] } {
  const values: (number | null)[] = columns.map(() => null);
  const withData = columns.map(() => 0);
  const total = columns.map(() => 0);
  let col = 0;
  days.forEach((day, i) => {
    while (col < columns.length - 1 && day > columns[col]!.to) col++;
    total[col]!++;
    if (cov[i] === 'none') return;
    withData[col]!++;
    values[col] = (values[col] ?? 0) + byDay[i]!;
  });
  return { values, withData, total };
}
