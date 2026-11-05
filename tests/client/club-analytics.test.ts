import { describe, expect, it } from 'vitest';
import { clubStateOf, coverageNote, freshnessLabel, sameCompany, todayIn, viewOf, zoneOf } from '../../src/client/lib/club-analytics';

/** Каркас отчёта клуба: свежесть, полоса покрытия, вид (спецификация «Аналитика клуба», §2.2, §3.3; план АК-1, задача 7). */
describe('каркас отчёта клуба', () => {
  it('подпись свежести — в поясе приложения; без забора — нет подписи', () => {
    expect(freshnessLabel('2026-11-03T17:05:00.000Z', 'Asia/Almaty')).toBe('Данные Senet на 03.11 22:05');
    expect(freshnessLabel(null, 'Asia/Almaty')).toBeNull();
  });

  it('полоса: будущие дни периода не считаются; ни одного дня — пусто; все дни — полосы нет', () => {
    const cov = { days: 6, withData: 2, missingDays: ['2026-11-01', '2026-11-02', '2026-11-05', '2026-11-06'] };
    expect(coverageNote(cov, '2026-11-04')).toEqual({ kind: 'partial', text: 'За 2 дня периода нет данных Senet — суммы неполные.' });
    expect(coverageNote({ days: 3, withData: 2, missingDays: ['2026-11-01'] }, '2026-11-04')!.text).toBe('За 1 день периода нет данных Senet — суммы неполные.');
    expect(coverageNote({ days: 3, withData: 0, missingDays: ['2026-11-01', '2026-11-02', '2026-11-03'] }, '2026-11-04')).toEqual({ kind: 'empty', text: 'За период нет данных Senet.' });
    expect(coverageNote({ days: 3, withData: 1, missingDays: ['2026-11-05', '2026-11-06'] }, '2026-11-04')).toBeNull();
  });

  it('вид, которого нет у отчёта, — первый из его видов', () => {
    expect(viewOf('hours', ['chart', 'table'])).toBe('chart');
    expect(viewOf('table', ['chart', 'table', 'hours'])).toBe('table');
  });

  it('настройки из адреса — с видом отчёта; сегодня — только с поясом', () => {
    expect(clubStateOf(new URLSearchParams('view=hours&by=x'), ['a', 'x'], ['chart', 'table'])).toMatchObject({ view: 'chart', by: 'x' });
    expect(todayIn(null)).toBeNull();
    expect(zoneOf(undefined)).toBeNull();
    expect(zoneOf({ timezone: 'Asia/Almaty' })).toBe('Asia/Almaty');
    expect(todayIn('Asia/Almaty')).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it('прежний ответ виден до нового только в той же компании', () => {
    expect(sameCompany(1, { queryKey: ['analytics', 1, 'club'] })).toBe(true);
    expect(sameCompany(1, { queryKey: ['analytics', 2, 'club'] })).toBe(false);
    expect(sameCompany(1, undefined)).toBe(false);
  });
});
