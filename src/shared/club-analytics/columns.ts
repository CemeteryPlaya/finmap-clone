import { addDays } from '../dates';
import type { ReportColumn } from '../report-engine';
import type { DayCoverage } from './coverage';

/** Даты периода `[from; to]` включительно. */
export function periodDays(from: string, to: string): string[] {
  const days: string[] = [];
  for (let d = from; d <= to; d = addDays(d, 1)) days.push(d);
  return days;
}

/** Прошлый период (§2.2 спецификации «Аналитика клуба»): той же длины, сразу перед текущим. */
export function previousRange(from: string, to: string): { from: string; to: string } {
  const length = periodDays(from, to).length;
  return { from: addDays(from, -length), to: addDays(from, -1) };
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
