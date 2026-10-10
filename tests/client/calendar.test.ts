import { describe, expect, it } from 'vitest';
import { addMonths, longDateRu, monthTitle, monthWeeks, moveDate, sameMonth, weekdayOf, WEEKDAYS } from '../../src/client/lib/calendar';

describe('календарь (§6.5 этапа 1.5)', () => {
  it('подписи: заголовок месяца и полная дата для программ чтения; неделя с понедельника', () => {
    expect(monthTitle('2026-10-04')).toBe('Октябрь 2026');
    expect(monthTitle('2027-01-31')).toBe('Январь 2027');
    expect(longDateRu('2026-10-04')).toBe('4 октября 2026');
    expect(longDateRu('2026-05-01')).toBe('1 мая 2026');
    expect(WEEKDAYS.map((w) => w.short)).toEqual(['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс']);
    expect(weekdayOf('2026-10-05')).toBe(0);
    expect(weekdayOf('2026-10-11')).toBe(6);
  });

  it('сетка месяца — целые недели с понедельника, с днями соседних месяцев', () => {
    const october = monthWeeks('2026-10-15');
    expect(october).toHaveLength(5);
    expect(october[0]).toEqual(['2026-09-28', '2026-09-29', '2026-09-30', '2026-10-01', '2026-10-02', '2026-10-03', '2026-10-04']);
    expect(october[4]![6]).toBe('2026-11-01');
    // февраль 2027 начинается в понедельник и кончается в воскресенье — ровно 4 недели
    const february = monthWeeks('2027-02-10');
    expect(february).toHaveLength(4);
    expect(february[0]![0]).toBe('2027-02-01');
    expect(february[3]![6]).toBe('2027-02-28');
    expect(sameMonth('2026-10-01', '2026-10-31')).toBe(true);
    expect(sameMonth('2026-09-30', '2026-10-01')).toBe(false);
  });

  it('сдвиг на месяцы: число не больше последнего дня месяца, через границу года, високосный февраль (Review Focus 1)', () => {
    expect(addMonths('2026-01-31', 1)).toBe('2026-02-28');
    expect(addMonths('2024-01-31', 1)).toBe('2024-02-29');
    expect(addMonths('2026-03-31', -1)).toBe('2026-02-28');
    expect(addMonths('2026-03-15', -3)).toBe('2025-12-15');
    expect(addMonths('2026-10-04', 12)).toBe('2027-10-04');
    expect(addMonths('2024-02-29', 12)).toBe('2025-02-28');
  });

  it('клавиши сетки: день, неделя, начало и конец недели, месяц, год; прочие — null (Review Focus 1)', () => {
    const d = '2026-10-07'; // среда
    expect(moveDate(d, 'ArrowLeft', false)).toBe('2026-10-06');
    expect(moveDate(d, 'ArrowRight', false)).toBe('2026-10-08');
    expect(moveDate(d, 'ArrowUp', false)).toBe('2026-09-30');
    expect(moveDate(d, 'ArrowDown', false)).toBe('2026-10-14');
    expect(moveDate(d, 'Home', false)).toBe('2026-10-05');
    expect(moveDate(d, 'End', false)).toBe('2026-10-11');
    expect(moveDate(d, 'PageUp', false)).toBe('2026-09-07');
    expect(moveDate(d, 'PageDown', false)).toBe('2026-11-07');
    expect(moveDate(d, 'PageUp', true)).toBe('2025-10-07');
    expect(moveDate(d, 'PageDown', true)).toBe('2027-10-07');
    // через Новый год; Home и End в понедельник и воскресенье
    expect(moveDate('2026-12-31', 'ArrowRight', false)).toBe('2027-01-01');
    expect(moveDate('2027-01-03', 'Home', false)).toBe('2026-12-28');
    expect(moveDate('2026-12-28', 'End', false)).toBe('2027-01-03');
    expect(moveDate('2026-03-31', 'PageUp', false)).toBe('2026-02-28');
    expect(moveDate(d, 'Enter', false)).toBeNull();
    expect(moveDate(d, 'a', false)).toBeNull();
  });
});
