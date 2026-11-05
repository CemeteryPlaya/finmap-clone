import { describe, expect, it } from 'vitest';
import { extremeHours, loadByDay, loadColumns, loadHeatmap, loadTotal, occupancy, sumZones, zoneStats, type LoadSession } from '../../src/shared/club-analytics/load';

/** Загрузка (спецификация «Аналитика клуба», §6.2, R10–R11; план АК-2, задача 1). Пояс Asia/Almaty (UTC+5); 02.11.2026 — понедельник. */
const TZ = 'Asia/Almaty';
const DAYS = ['2026-11-02', '2026-11-03'];
/** Местное время клуба → ISO UTC. */
const at = (local: string) => new Date(Date.parse(`${local}:00Z`) - 5 * 3_600_000).toISOString();
const s = (zone: string, workstation: number | null, from: string, to: string | null, debited = 0): LoadSession => ({
  zone,
  workstation,
  startAt: at(from),
  endAt: to === null ? null : at(to),
  debited,
});
const empty = () => DAYS.map(() => Array.from({ length: 24 }, () => 0));

describe('occupancy', () => {
  const occ = occupancy(
    [
      s('A', 1, '2026-11-02T19:30', '2026-11-02T21:00'),
      s('A', 1, '2026-11-02T20:00', '2026-11-02T20:30'),
      s('B', 2, '2026-11-02T23:30', '2026-11-03T00:30'),
      s('B', 3, '2026-11-02T12:00', null),
      s('A', null, '2026-11-02T10:00', '2026-11-02T10:30'),
      s('A', null, '2026-11-02T10:00', '2026-11-02T10:30'),
      s('C', 4, '2026-11-01T23:00', '2026-11-02T01:00'),
    ],
    DAYS,
    TZ,
  );

  it('наложенные сеансы одного места сливаются: загрузка места не больше часа в часе', () => {
    expect(occ.get('A')![0]![19]).toBe(1800);
    expect(occ.get('A')![0]![20]).toBe(3600);
  });

  it('сеанс через полночь — в оба дня; сеанс без конца не учитывается', () => {
    expect(occ.get('B')![0]![23]).toBe(1800);
    expect(occ.get('B')![1]![0]).toBe(1800);
    expect(occ.get('B')![0]![12]).toBe(0);
  });

  it('сеансы без места не сливаются', () => {
    expect(occ.get('A')![0]![10]).toBe(3600);
  });

  it('часть сеанса до периода отбрасывается', () => {
    expect(occ.get('C')![0]![0]).toBe(3600);
    expect(occ.get('C')!.flat().reduce((a, b) => a + b, 0)).toBe(3600);
  });

  it('sumZones складывает зоны по дням и часам', () => {
    expect(sumZones(occ, DAYS.length)[0]![10]).toBe(3600);
    expect(sumZones(new Map(), 2)).toEqual(empty());
  });
});

describe('средние загрузки — только по полным дням', () => {
  const occ = empty();
  occ[0]![20] = 17_280;
  occ[1]![20] = 3600;
  const cov = ['full', 'partial'] as const;
  const col = (from: string, to: string) => ({ key: from, from, to, label: from });

  it('за период, по дням и по колонкам шага', () => {
    expect(loadTotal(occ, 2, cov)).toBe(0.1);
    expect(loadByDay(occ, 2, cov)).toEqual([0.1, null]);
    expect(loadColumns(occ, 2, DAYS, cov, [col('2026-11-02', '2026-11-03')])).toEqual([0.1]);
    expect(loadColumns(occ, 2, DAYS, cov, [col('2026-11-02', '2026-11-02'), col('2026-11-03', '2026-11-03')])).toEqual([0.1, null]);
  });

  it('нет полных дней или мест — null', () => {
    expect(loadTotal(occ, 2, ['partial', 'none'])).toBeNull();
    expect(loadTotal(occ, 0, cov)).toBeNull();
  });

  it('карта «день недели × час» — среднее по полным дням этого дня недели', () => {
    const one = empty();
    one[0]![20] = 3600;
    const map = loadHeatmap(one, 2, DAYS, cov);
    expect(map).toHaveLength(7);
    expect(map[0]).toHaveLength(24);
    expect(map[0]![20]).toBe(0.5);
    expect(map[0]![3]).toBe(0);
    expect(map[1]![20]).toBeNull();
  });
});

describe('extremeHours', () => {
  const map = Array.from({ length: 7 }, () => Array.from({ length: 24 }, (): number | null => null));
  map[4]![20] = 0.9;
  map[0]![21] = 0.9;
  map[2]![5] = 0.1;

  it('часы пик и простоя; равные — раньше день недели, затем час; пустые пропускаются', () => {
    expect(extremeHours(map, 2, 'max')).toEqual([
      { weekday: 0, hour: 21, value: 0.9 },
      { weekday: 4, hour: 20, value: 0.9 },
    ]);
    expect(extremeHours(map, 1, 'min')).toEqual([{ weekday: 2, hour: 5, value: 0.1 }]);
    expect(extremeHours(map, 5, 'min')).toHaveLength(3);
  });
});

describe('zoneStats', () => {
  const sessions = [s('A', 1, '2026-11-02T10:00', '2026-11-02T11:00', 30_000), s('A', 2, '2026-11-02T12:00', '2026-11-02T13:00', 0), s('A', 1, '2026-11-02T14:00', '2026-11-02T15:00', 60_000), s('A', 2, '2026-11-02T16:00', null, 5_000)];

  it('сеансы, на место в день, длительность, часы, списано и на место в час', () => {
    expect(zoneStats(sessions, 2, 1)).toEqual({ sessions: 3, sessionsPerSeatDay: 1.5, avgSessionSec: 3600, hours: 3, debited: 90_000, debitedPerSeatHour: 1875 });
  });

  it('нет полных дней или сеансов — средние null', () => {
    expect(zoneStats(sessions, 2, 0)).toMatchObject({ sessionsPerSeatDay: null, debitedPerSeatHour: null });
    expect(zoneStats([], 2, 1)).toEqual({ sessions: 0, sessionsPerSeatDay: 0, avgSessionSec: null, hours: 0, debited: 0, debitedPerSeatHour: 0 });
  });
});
