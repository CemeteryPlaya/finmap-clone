import { describe, expect, it } from 'vitest';
import { formatMoney } from '../../src/shared/money';
import { chartSeries, clubMoney, countCell, heatColor, heatLabel, missingText, reconcileTotal, revenueApprox, revenueCellRow, revenueCellTitle, shiftHref, shiftLink } from '../../src/client/lib/club-revenue';

/** «Выручка клуба» на экране (спецификация «Аналитика клуба», §5; план АК-1, задача 8). */
const col = { key: '2026-11-01', from: '2026-11-01', to: '2026-11-01', label: '1 ноя' };
const money = (v: number) => formatMoney(v, 'KZT', { trimZeroMinor: true });

describe('«Выручка клуба»: экран', () => {
  it('заголовок списка ячейки: колонка или весь период', () => {
    expect(revenueCellTitle({ label: 'Бар' }, col)).toBe('Бар за 1 ноя');
    expect(revenueCellTitle({ label: 'Бар' }, null)).toBe('Бар за период');
  });

  it('карта часов: шесть ступеней от нуля к максимуму; нет данных — штриховка', () => {
    expect(heatColor(0, 100)).not.toBe(heatColor(100, 100));
    expect(new Set([0, 10, 30, 50, 70, 100].map((v) => heatColor(v, 100))).size).toBe(6);
    expect(heatColor(0, 0)).toBe(heatColor(0, 100));
    expect(heatColor(null, 100)).toContain('repeating-linear-gradient');
    expect(heatLabel(0, 20, 600_000)).toBe(`Пн, 20:00–21:00: ${money(600_000)}`);
    expect(heatLabel(6, 23, null)).toBe('Вс, 23:00–24:00: нет данных');
  });

  it('колонка с днями без данных — подпись «данные не за все дни (N из M)»', () => {
    expect(missingText(2, 3)).toBe('данные не за все дни (2 из 3)');
    expect(missingText(3, 3)).toBeNull();
  });

  it('ячейки со списком строк Senet: части выручки и справочные, кроме разницы; разрезы по сменам, кассирам и оплате — нет', () => {
    expect(revenueCellRow('bar')).toBe('bar');
    expect(revenueCellRow('desk')).toBe('desk');
    expect(revenueCellRow('diff')).toBeNull();
    expect(revenueCellRow('shift:5')).toBeNull();
    expect(revenueCellRow('payment:Наличный расчет')).toBeNull();
  });

  it('Δ сумм — с «≈», если в любом из периодов есть прошедшие дни без данных', () => {
    const full = { coverage: { days: 3, withData: 3, missingDays: [] }, prevCoverage: { days: 3, withData: 3 } };
    expect(revenueApprox(full, '2026-11-04')).toBe(false);
    expect(revenueApprox({ ...full, coverage: { days: 3, withData: 2, missingDays: ['2026-11-02'] } }, '2026-11-04')).toBe(true);
    expect(revenueApprox({ ...full, coverage: { days: 30, withData: 3, missingDays: ['2026-11-05'] } }, '2026-11-04')).toBe(false);
    expect(revenueApprox({ ...full, prevCoverage: { days: 3, withData: 1 } }, '2026-11-04')).toBe(true);
    expect(revenueApprox({ ...full, prevCoverage: null }, '2026-11-04')).toBe(false);
  });

  it('график: столбцы «Часы» и «Бар», линия «Деньги в кассу»; нет данных — 0', () => {
    const rows = [
      { id: 'hours', values: [100, null] },
      { id: 'bar', values: [20, 5] },
      { id: 'desk', values: [90, null] },
      { id: 'revenue', values: [120, 5] },
    ];
    expect(chartSeries(rows)).toEqual({ income: [100, 0], expense: [20, 5], line: [90, 0] });
    expect(chartSeries([])).toEqual({ income: [], expense: [], line: [] });
  });

  it('«Не сходится со сменами»: сумма расхождений', () => {
    expect(reconcileTotal([{ diff: 5_000 }, { diff: -2_000 }])).toBe(3_000);
  });

  it('ссылка на смену в «Сверке» и её разбор', () => {
    expect(shiftHref(1, 42, '2026-11-01')).toBe('/c/1/senet/shifts?shift=42&day=2026-11-01');
    expect(shiftLink(new URLSearchParams('shift=42&day=2026-11-01'))).toEqual({ shift: 42, day: '2026-11-01' });
    expect(shiftLink(new URLSearchParams('shift=x&day=2026-11-01'))).toBeNull();
    expect(shiftLink(new URLSearchParams('shift=42&day=вчера'))).toBeNull();
    expect(shiftLink(new URLSearchParams(''))).toBeNull();
  });

  it('число, а не деньги — только колонка «Смен» у кассиров; итог (−1) — всегда деньги', () => {
    expect(countCell('cashiers', 1)).toBe(true);
    expect(countCell('cashiers', 0)).toBe(false);
    expect(countCell('parts', -1)).toBe(false);
    expect(countCell('cashiers', -1)).toBe(false);
  });

  it('суммы клуба — в целых тенге: средние карты часов без тиынов', () => {
    expect(clubMoney(4_416_342)).toBe(money(4_416_300));
    expect(clubMoney(-50)).toBe(money(-100));
    expect(clubMoney(600_000)).toBe(money(600_000));
  });
});
