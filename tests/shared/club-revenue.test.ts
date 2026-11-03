import { describe, expect, it } from 'vitest';
import { periodDays, previousRange, sumColumns } from '../../src/shared/club-analytics/columns';
import { deskByPayment, revenueByDay, revenueHeatmap, type RevenueInput } from '../../src/shared/club-analytics/revenue';
import { reportColumns } from '../../src/shared/report-engine';

/** Выручка клуба по дням (спецификация «Аналитика клуба», §5.1, §5.3; план АК-1, задача 5). */
const TZ = 'Asia/Almaty';
const at = (local: string) => new Date(Date.parse(`${local}+05:00`)).toISOString();
const empty: RevenueInput = { load: [], sold: [], refills: [], transactions: [] };

describe('выручка клуба', () => {
  it('часы — в день начала сеанса; бар — товары нетто; чек времени — не бар; пополнения — только General; деньги в кассу и разница', () => {
    const input: RevenueInput = {
      load: [{ startAt: at('2026-11-01T23:30:00'), endAt: at('2026-11-02T01:00:00'), debited: 1000 }],
      sold: [
        { at: at('2026-11-02T12:00:00'), qty: 1000, amount: 500, refund: false },
        { at: at('2026-11-02T13:00:00'), qty: 1000, amount: 200, refund: true },
        { at: at('2026-11-02T14:00:00'), qty: null, amount: 1000, refund: false },
      ],
      refills: [
        { at: at('2026-11-02T15:00:00'), amount: 700, accountType: 'Check' },
        { at: at('2026-11-02T16:00:00'), amount: 400, accountType: 'General' },
      ],
      transactions: [
        { at: at('2026-11-02T12:00:00'), kind: 'sell', amount: 1500, payment: 'Наличный расчет' },
        { at: at('2026-11-02T13:00:00'), kind: 'refund', amount: 200, payment: 'Наличный расчет' },
        { at: at('2026-11-02T17:00:00'), kind: 'sell', amount: 300, payment: 'Безналичный расчет' },
      ],
    };
    const r = revenueByDay(input, ['2026-11-01', '2026-11-02'], TZ);
    expect(r.hours).toEqual([1000, 0]);
    expect(r.bar).toEqual([0, 300]);
    expect(r.revenue).toEqual([1000, 300]);
    expect(r.refills).toEqual([0, 400]);
    expect(r.desk).toEqual([0, 1600]);
    expect(r.diff).toEqual([-1000, 1300]);
    expect(deskByPayment(input.transactions, ['2026-11-01', '2026-11-02'], TZ)).toEqual(
      new Map([
        ['Наличный расчет', [0, 1300]],
        ['Безналичный расчет', [0, 300]],
      ]),
    );
  });

  it('строки вне дней периода не учитываются', () => {
    const r = revenueByDay({ ...empty, load: [{ startAt: at('2026-10-31T10:00:00'), endAt: at('2026-10-31T11:00:00'), debited: 999 }] }, ['2026-11-01'], TZ);
    expect(r.hours).toEqual([0]);
  });

  it('колонки: сумма дней с данными, null без данных; прошлый период той же длины', () => {
    const days = periodDays('2026-11-01', '2026-11-03');
    expect(days).toEqual(['2026-11-01', '2026-11-02', '2026-11-03']);
    const cols = reportColumns('2026-11-01', '2026-11-03', 'month');
    expect(sumColumns([5, 7, 11], days, cols, ['none', 'full', 'partial'])).toEqual({ values: [18], withData: [2], total: [3] });
    expect(sumColumns([5, 7, 11], days, reportColumns('2026-11-01', '2026-11-03', 'day'), ['none', 'full', 'partial'])).toEqual({ values: [null, 7, 11], withData: [0, 1, 1], total: [1, 1, 1] });
    expect(previousRange('2026-11-01', '2026-11-30')).toEqual({ from: '2026-10-02', to: '2026-10-31' });
  });

  it('карта часов: средняя по дням недели с полными данными; списание сеанса — пропорционально времени', () => {
    const input: RevenueInput = { ...empty, load: [{ startAt: at('2026-11-02T20:00:00'), endAt: at('2026-11-02T21:30:00'), debited: 900 }], sold: [{ at: at('2026-11-02T20:10:00'), qty: 1000, amount: 50, refund: false }] };
    const map = revenueHeatmap(input, ['2026-11-02', '2026-11-03'], ['full', 'none'], TZ);
    expect(map).toHaveLength(7);
    expect(map[0]![20]).toBe(650);
    expect(map[0]![21]).toBe(300);
    expect(map[0]![5]).toBe(0);
    expect(map[1]![20]).toBeNull();
  });

  it('карта часов: среднее по двум понедельникам; доля сеанса — точно по секундам', () => {
    const input: RevenueInput = {
      ...empty,
      load: [
        { startAt: at('2026-11-02T20:00:00'), endAt: at('2026-11-02T21:30:00'), debited: 54_000 },
        { startAt: at('2026-11-09T20:00:00'), endAt: at('2026-11-09T21:00:00'), debited: 10_000 },
      ],
    };
    const map = revenueHeatmap(input, ['2026-11-02', '2026-11-09'], ['full', 'full'], TZ);
    expect(map[0]![20]).toBe((36_000 + 10_000) / 2);
    expect(map[0]![21]).toBe(18_000 / 2);
  });

  it('карта часов: идущий сеанс не учитывается, возврат бара вычитается, чек времени — не бар', () => {
    const input: RevenueInput = {
      ...empty,
      load: [{ startAt: at('2026-11-02T10:00:00'), endAt: null, debited: 500 }],
      sold: [
        { at: at('2026-11-02T10:05:00'), qty: 1000, amount: 300, refund: false },
        { at: at('2026-11-02T10:20:00'), qty: 1000, amount: 100, refund: true },
        { at: at('2026-11-02T10:30:00'), qty: null, amount: 900, refund: false },
      ],
    };
    expect(revenueHeatmap(input, ['2026-11-02'], ['full'], TZ)[0]![10]).toBe(200);
  });
});
