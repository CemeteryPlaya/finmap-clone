import { describe, expect, it } from 'vitest';
import { msToNextMinute, nowParts } from '../../src/client/lib/use-now';

describe('«живое» время поля даты (§2.3 этапа 1.5)', () => {
  it('следующее обновление — в начале следующей минуты', () => {
    expect(msToNextMinute(Date.parse('2026-10-10T10:58:00.000Z'))).toBe(60_000);
    expect(msToNextMinute(Date.parse('2026-10-10T10:58:59.900Z'))).toBe(100);
    expect(msToNextMinute(Date.parse('2026-10-10T10:58:30.250Z'))).toBe(29_750);
  });

  it('«сегодня» и время берутся из одного момента: у границы суток они не расходятся (R4c)', () => {
    // 23:59:59 по Алматы (UTC+5) и через секунду — 00:00 следующего дня
    expect(nowParts(Date.parse('2026-10-10T18:59:59.000Z'), 'Asia/Almaty')).toEqual({ today: '2026-10-10', time: '23:59' });
    expect(nowParts(Date.parse('2026-10-10T19:00:00.000Z'), 'Asia/Almaty')).toEqual({ today: '2026-10-11', time: '00:00' });
  });
});
