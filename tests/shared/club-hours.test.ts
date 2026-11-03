import { describe, expect, it } from 'vitest';
import { localParts, splitByHour } from '../../src/shared/club-analytics/hours';

/** Раскладка сеанса по часам местного времени (спецификация «Аналитика клуба», §5.3, §6.2; план АК-1, задача 5). */
const TZ = 'Asia/Almaty';
const at = (local: string) => new Date(Date.parse(`${local}+05:00`)).toISOString();

describe('раскладка по часам', () => {
  it('сеанс через полночь — части по часам и дням', () => {
    expect(splitByHour(at('2026-11-01T23:30:00'), at('2026-11-02T01:15:00'), TZ).map(({ day, hour, seconds }) => ({ day, hour, seconds }))).toEqual([
      { day: '2026-11-01', hour: 23, seconds: 1800 },
      { day: '2026-11-02', hour: 0, seconds: 3600 },
      { day: '2026-11-02', hour: 1, seconds: 900 },
    ]);
  });

  it('день недели: 02.11.2026 — понедельник (0), 01.11 — воскресенье (6)', () => {
    const parts = splitByHour(at('2026-11-01T23:30:00'), at('2026-11-02T00:30:00'), TZ);
    expect(parts.map((p) => p.weekday)).toEqual([6, 0]);
    expect(localParts(at('2026-11-02T20:15:00'), TZ)).toEqual({ day: '2026-11-02', hour: 20, weekday: 0 });
  });

  it('конец не позже начала — пусто', () => {
    expect(splitByHour(at('2026-11-02T10:00:00'), at('2026-11-02T10:00:00'), TZ)).toEqual([]);
    expect(splitByHour(at('2026-11-02T10:00:00'), at('2026-11-02T09:00:00'), TZ)).toEqual([]);
  });
});
