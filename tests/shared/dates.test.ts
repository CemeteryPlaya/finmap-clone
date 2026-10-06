import { describe, expect, it } from 'vitest';
import { formatDateRu, formatDateTime, isValidDate, todayInTimezone } from '../../src/shared/dates';

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

describe('isValidDate', () => {
  it('формат YYYY-MM-DD и существующая календарная дата', () => {
    expect(isValidDate('2026-10-06')).toBe(true);
    expect(isValidDate('2024-02-29')).toBe(true);
    expect(isValidDate('2026-02-29')).toBe(false);
    expect(isValidDate('2026-02-31')).toBe(false);
    expect(isValidDate('2026-13-01')).toBe(false);
    expect(isValidDate('2026-00-10')).toBe(false);
    expect(isValidDate('2026-1-01')).toBe(false);
    expect(isValidDate('06.10.2026')).toBe(false);
  });
});

describe('formatDateRu', () => {
  it('ГГГГ-ММ-ДД → ДД.ММ.ГГГГ', () => {
    expect(formatDateRu('2026-10-06')).toBe('06.10.2026');
  });
});

describe('formatDateTime', () => {
  it('дата и время в заданном поясе', () => {
    expect(formatDateTime('2026-10-06T19:30:00.000Z', 'UTC')).toBe('06.10.2026, 19:30');
    expect(formatDateTime('2026-10-06T23:30:00.000Z', 'Etc/GMT-5')).toBe('07.10.2026, 04:30'); // UTC+5, как Алматы
  });
});
