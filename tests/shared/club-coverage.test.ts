import { describe, expect, it } from 'vitest';
import { combineCoverage, dayCoverage, mergeSpans } from '../../src/shared/club-analytics/coverage';

/** Покрытие данных Senet отрезками забора (спецификация 2026-11-03-club-analytics, §3.2, решение R1; план АК-1, задача 1). */
const TZ = 'Asia/Almaty';
const H = 3_600_000;
/** Местное время Алматы (UTC+5) → ISO UTC. */
const at = (local: string) => new Date(Date.parse(`${local}:00+05:00`)).toISOString();
const iso = (ms: number) => new Date(ms).toISOString();

describe('покрытие данных Senet', () => {
  it('mergeSpans сливает пересекающиеся и смежные отрезки и сортирует', () => {
    const h = (n: number) => iso(Date.UTC(2026, 10, 1, n));
    const spans = [
      { from: h(16), to: h(17) },
      { from: h(11), to: h(13) },
      { from: h(10), to: h(12) },
      { from: h(13), to: h(14) },
    ];
    expect(mergeSpans(spans)).toEqual([
      { from: h(10), to: h(14) },
      { from: h(16), to: h(17) },
    ]);
  });

  it('окна часового забора [t−26 ч, t): прошедшие сутки полные, текущие — частичные, будущие — нет данных', () => {
    const spans = [];
    for (let t = Date.parse(at('2026-11-02T00:00')); t <= Date.parse(at('2026-11-03T12:00')); t += H) spans.push({ from: iso(t - 26 * H), to: iso(t) });
    expect(dayCoverage(spans, ['2026-11-01', '2026-11-02', '2026-11-03', '2026-11-04'], TZ)).toEqual(['full', 'full', 'partial', 'none']);
  });

  it('граница суток — местная полночь, а не UTC', () => {
    const spans = [{ from: '2026-11-01T19:00:00.000Z', to: '2026-11-02T19:00:00.000Z' }];
    expect(dayCoverage(spans, ['2026-11-01', '2026-11-02'], TZ)).toEqual(['none', 'full']);
  });

  it('combineCoverage — поэлементный минимум: none < partial < full', () => {
    expect(
      combineCoverage([
        ['full', 'full', 'none'],
        ['full', 'partial', 'full'],
      ]),
    ).toEqual(['full', 'partial', 'none']);
  });
});
