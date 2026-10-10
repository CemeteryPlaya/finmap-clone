import { describe, expect, it } from 'vitest';
import { addDays, formatDateRu, formatDateTime, formatDateTimeSec, isValidDate, startOfDayUtc, todayInTimezone, zoneOffsetMs } from '../../src/shared/dates';

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

describe('addDays', () => {
  it('календарный сдвиг через границы месяца и года', () => {
    expect(addDays('2026-10-08', -7)).toBe('2026-10-01');
    expect(addDays('2026-03-01', -1)).toBe('2026-02-28');
    expect(addDays('2024-03-01', -1)).toBe('2024-02-29');
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
  });
});

describe('startOfDayUtc', () => {
  it('начало суток в Алматы — момент UTC; смещение берётся на эту дату (UTC+6 до 01.03.2024) (Review Focus 1)', () => {
    expect(startOfDayUtc('2026-10-05', 'Asia/Almaty')).toBe('2026-10-04T19:00:00.000Z');
    expect(startOfDayUtc('2024-01-15', 'Asia/Almaty')).toBe('2024-01-14T18:00:00.000Z');
    // 29.02.2024 длился 25 часов: в полночь 1 марта часы перевели на 23:00
    expect(startOfDayUtc('2024-02-29', 'Asia/Almaty')).toBe('2024-02-28T18:00:00.000Z');
    expect(startOfDayUtc('2024-03-01', 'Asia/Almaty')).toBe('2024-02-29T19:00:00.000Z');
  });

  it('пояса с переходом на летнее время и UTC', () => {
    expect(startOfDayUtc('2026-03-29', 'Europe/Berlin')).toBe('2026-03-28T23:00:00.000Z');
    expect(startOfDayUtc('2026-10-25', 'Europe/Berlin')).toBe('2026-10-24T22:00:00.000Z');
    expect(startOfDayUtc('2026-10-05', 'UTC')).toBe('2026-10-05T00:00:00.000Z');
  });
});

describe('zoneOffsetMs', () => {
  it('смещение в момент времени, миллисекунды не мешают', () => {
    expect(zoneOffsetMs(Date.parse('2026-10-05T05:00:00.500Z'), 'Asia/Almaty')).toBe(5 * 3600_000);
    expect(zoneOffsetMs(Date.parse('2024-01-15T05:00:00.000Z'), 'Asia/Almaty')).toBe(6 * 3600_000);
  });
});

describe('formatDateTimeSec', () => {
  it('дата и время до секунд в поясе приложения', () => {
    expect(formatDateTimeSec('2026-10-04T05:32:15.000Z', 'Asia/Almaty')).toBe('04.10.2026, 10:32:15');
    expect(formatDateTimeSec('2026-10-04T19:00:01.000Z', 'Asia/Almaty')).toBe('05.10.2026, 00:00:01');
  });
});
