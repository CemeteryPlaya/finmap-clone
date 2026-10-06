import { describe, expect, it } from 'vitest';
import { todayInTimezone } from '../../src/shared/dates';

describe('todayInTimezone', () => {
  it('возвращает календарную дату в указанном поясе', () => {
    // 19:30 UTC 5 октября = 00:30 6 октября в Алматы (UTC+5)
    expect(todayInTimezone('Asia/Almaty', new Date('2026-10-05T19:30:00.000Z'))).toBe('2026-10-06');
    expect(todayInTimezone('UTC', new Date('2026-10-05T19:30:00.000Z'))).toBe('2026-10-05');
  });

  it('23:30 в Алматы остаётся тем же календарным днём', () => {
    // 18:30 UTC 5 октября = 23:30 5 октября в Алматы (UTC+5)
    expect(todayInTimezone('Asia/Almaty', new Date('2026-10-05T18:30:00.000Z'))).toBe('2026-10-05');
  });
});
