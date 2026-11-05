import { describe, expect, it } from 'vitest';
import { formatMoney } from '../../src/shared/money';
import { bestWorstText, overviewChart, overviewHref, sparkPath, tileValueText, type OverviewTile } from '../../src/client/lib/club-overview';
import { clubChangedFor, DEFAULT_CLUB_STATE } from '../../src/client/lib/club-url';

/** «Обзор клуба» — подписи плиток и ссылки (спецификация «Аналитика клуба», §4; план АК-1, задача 9). */
const tile = (t: Partial<OverviewTile>): OverviewTile => ({
  key: 'revenue',
  label: 'Выручка',
  unit: 'money',
  kind: 'sum',
  value: null,
  prev: null,
  approx: false,
  spark: [],
  available: true,
  note: null,
  href: 'club/revenue',
  ...t,
});

describe('tileValueText', () => {
  it('деньги — в целых тенге, доля — процент с одним знаком, число — как есть', () => {
    expect(tileValueText(tile({ value: 640_050 }))).toBe(formatMoney(640_100, 'KZT', { trimZeroMinor: true }));
    expect(tileValueText(tile({ unit: 'percent', kind: 'share', value: 0.425 }))).toBe('42,5 %');
    expect(tileValueText(tile({ unit: 'number', value: 17 }))).toBe('17');
  });

  it('нет значения: недоступная плитка — пометка, доступная — «нет данных»', () => {
    expect(tileValueText(tile({ available: false, note: 'Появится с отчётом «Загрузка»' }))).toBe('Появится с отчётом «Загрузка»');
    expect(tileValueText(tile({ value: null }))).toBe('нет данных');
  });
});

describe('overviewHref', () => {
  it('отчёт клуба — с периодом и клубом «Обзора»; журнал — «Прибыль» за тот же период', () => {
    expect(overviewHref(5, 'club/revenue', 'period=month&project=3&compare=0', 'period=month')).toBe('/c/5/analytics/club/revenue?period=month&project=3&compare=0');
    expect(overviewHref(5, 'pnl', 'period=month&project=3', 'period=month')).toBe('/c/5/analytics/pnl?period=month');
    expect(overviewHref(5, 'club/revenue', '', '')).toBe('/c/5/analytics/club/revenue');
  });
});

describe('«Загрузка» в «Обзоре»', () => {
  it('плитка «Загрузка ПК» — процентом; «Часы пик» ведут в «Загрузку» с периодом и клубом', () => {
    expect(tileValueText(tile({ key: 'load', label: 'Загрузка ПК', unit: 'percent', kind: 'share', value: 0.94, href: 'club/load' }))).toBe('94 %');
    expect(overviewHref(5, 'club/load', 'from=2026-11-01&to=2026-11-30&project=3', '')).toBe('/c/5/analytics/club/load?from=2026-11-01&to=2026-11-30&project=3');
  });

  it('ряды графика «Выручка и загрузка по дням»: день без данных — 0 в столбцах, null в линии', () => {
    expect(
      overviewChart([
        { day: '2026-11-01', revenue: 100, load: 0.5, coverage: 'full' },
        { day: '2026-11-02', revenue: null, load: null, coverage: 'none' },
      ]),
    ).toEqual({ revenue: [100, 0], load: [0.5, null] });
  });
});

describe('bestWorstText', () => {
  it('день — «пт, 1 ноя»', () => {
    expect(bestWorstText('2026-11-06')).toBe('пт, 6 ноя');
  });
});

describe('clubChangedFor', () => {
  it('у отчёта без шага шаг из адреса не считается изменённым', () => {
    const range = { from: '2026-01-01', to: '2026-12-31' };
    const state = { ...DEFAULT_CLUB_STATE, step: 'week' as const };
    expect(clubChangedFor(state, [], range, true).step).toBe(true);
    // шаг не виден (у «Обзора» — нигде, у «Загрузки» — вне «графика») — не считается изменённым
    expect(clubChangedFor(state, [], range, false).step).toBe(false);
  });
});

describe('sparkPath', () => {
  it('ряд по дням — в рамке 100×24 снизу вверх; день без данных — разрыв; пусто и один день — без линии', () => {
    expect(sparkPath([0, 10, 5])).toBe('M0,24L50,0L100,12');
    expect(sparkPath([10, null, 10, 0])).toBe('M0,0M66.67,0L100,24');
    expect(sparkPath([])).toBe('');
    expect(sparkPath([5])).toBe('');
    expect(sparkPath([3, 3])).toBe('M0,12L100,12');
  });
});
