import { addDays, startOfDayUtc } from '../dates';

/** Отрезок забора Senet: моменты ISO UTC, `to` не входит. */
export interface Span {
  from: string;
  to: string;
}

/** Покрытие дня данными (§3.2–3.3 спецификации «Аналитика клуба»): весь день, часть дня (так выглядит текущий) или ничего. */
export type DayCoverage = 'full' | 'partial' | 'none';

const RANK: Record<DayCoverage, number> = { none: 0, partial: 1, full: 2 };
const BY_RANK: readonly DayCoverage[] = ['none', 'partial', 'full'];

/** Отрезки без пересечений и стыков, по возрастанию. Строки ISO одной длины сравниваются как время. */
export function mergeSpans(spans: readonly Span[]): Span[] {
  const sorted = [...spans].sort((a, b) => (a.from < b.from ? -1 : a.from > b.from ? 1 : 0));
  const out: Span[] = [];
  for (const s of sorted) {
    const last = out.at(-1);
    if (last && s.from <= last.to) {
      if (s.to > last.to) last.to = s.to;
    } else out.push({ ...s });
  }
  return out;
}

/** Покрытие каждого дня `days` (локальные даты timeZone) объединением отрезков (решение R1). */
export function dayCoverage(spans: readonly Span[], days: readonly string[], timeZone: string): DayCoverage[] {
  const merged = mergeSpans(spans).map((s) => ({ from: Date.parse(s.from), to: Date.parse(s.to) }));
  return days.map((day) => {
    const start = Date.parse(startOfDayUtc(day, timeZone));
    const end = Date.parse(startOfDayUtc(addDays(day, 1), timeZone));
    let covered = 0;
    for (const s of merged) covered += Math.max(0, Math.min(s.to, end) - Math.max(s.from, start));
    return covered >= end - start ? 'full' : covered > 0 ? 'partial' : 'none';
  });
}

/** Покрытие по нескольким отчётам или клубам: день не лучше худшего из них. */
export function combineCoverage(lists: readonly (readonly DayCoverage[])[]): DayCoverage[] {
  const [head, ...rest] = lists;
  if (!head) return [];
  return head.map((c, i) => BY_RANK[Math.min(RANK[c], ...rest.map((l) => RANK[l[i] ?? 'none']))]!);
}
