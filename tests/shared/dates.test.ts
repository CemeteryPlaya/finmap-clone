import { describe, expect, it } from 'vitest';
import { addDays, formatDateRu, formatDateShortRu, formatDateTime, formatDateTimeField, formatDateTimeSec, isValidDate, parseTimeInput, timeOfDay, startOfDayUtc, todayInTimezone, zoneOffsetMs } from '../../src/shared/dates';

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

describe('formatDateShortRu', () => {
  it('«4 окт. 2026»: число без нуля, сокращения месяцев как в Finmap, без «г.» (§2.3 этапа 1.5)', () => {
    const months = ['01', '02', '03', '04', '05', '06', '07', '08', '09', '10', '11', '12'];
    expect(months.map((m) => formatDateShortRu(`2026-${m}-04`))).toEqual([
      '4 янв. 2026',
      '4 февр. 2026',
      '4 мар. 2026',
      '4 апр. 2026',
      '4 мая 2026',
      '4 июн. 2026',
      '4 июл. 2026',
      '4 авг. 2026',
      '4 сент. 2026',
      '4 окт. 2026',
      '4 нояб. 2026',
      '4 дек. 2026',
    ]);
    expect(formatDateShortRu('2026-10-31')).toBe('31 окт. 2026');
  });
});

describe('formatDateTimeField — поле даты и времени формы (§2.3 этапа 1.5)', () => {
  it('«Сегодня», «Вчера», иначе день недели с заглавной', () => {
    expect(formatDateTimeField('2026-10-10', '15:58', '2026-10-10')).toBe('Сегодня, 10.10.2026, 15:58');
    expect(formatDateTimeField('2026-10-09', '22:09', '2026-10-10')).toBe('Вчера, 09.10.2026, 22:09');
    expect(formatDateTimeField('2026-10-04', '10:31', '2026-10-10')).toBe('Воскресенье, 04.10.2026, 10:31');
    expect(formatDateTimeField('2026-10-05', '09:00', '2026-10-10')).toBe('Понедельник, 05.10.2026, 09:00');
    expect(formatDateTimeField('2026-10-03', '00:05', '2026-10-10')).toBe('Суббота, 03.10.2026, 00:05');
  });

  it('«Вчера» через границу месяца и года (Review Focus 2)', () => {
    expect(formatDateTimeField('2026-10-31', '23:59', '2026-11-01')).toBe('Вчера, 31.10.2026, 23:59');
    expect(formatDateTimeField('2026-12-31', '12:00', '2027-01-01')).toBe('Вчера, 31.12.2026, 12:00');
  });
});

describe('timeOfDay — время суток момента в поясе приложения', () => {
  it('«ЧЧ:ММ» в 24-часовом формате; смещение — на дату момента (UTC+6 до 01.03.2024)', () => {
    expect(timeOfDay('2026-10-10T10:58:00.000Z', 'Asia/Almaty')).toBe('15:58');
    expect(timeOfDay('2026-10-09T19:05:30.000Z', 'Asia/Almaty')).toBe('00:05');
    expect(timeOfDay('2024-01-15T04:30:00.000Z', 'Asia/Almaty')).toBe('10:30');
    expect(timeOfDay('2026-10-10T10:58:00.000Z', 'UTC')).toBe('10:58');
  });
});

describe('parseTimeInput — поле «Время» (§6.5 этапа 1.5)', () => {
  it('принимает 9:05, 09:05, 0905, 905, 9.05 и пробелы по краям', () => {
    expect(parseTimeInput('9:05')).toBe('09:05');
    expect(parseTimeInput('09:05')).toBe('09:05');
    expect(parseTimeInput('0905')).toBe('09:05');
    expect(parseTimeInput('905')).toBe('09:05');
    expect(parseTimeInput('9.05')).toBe('09:05');
    expect(parseTimeInput(' 23:59 ')).toBe('23:59');
    expect(parseTimeInput('0:00')).toBe('00:00');
  });

  it('неверное — null', () => {
    for (const bad of ['', '9', '24:00', '12:60', '12:5', 'ab:cd', '12345', '-1:00', '12:00:00']) expect(parseTimeInput(bad), bad).toBeNull();
  });
});
