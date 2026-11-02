import { describe, expect, it } from 'vitest';
import { defaultPeriod, SHIFT_STATE_TEXT, shiftPeriodLabel, senetTabVisible } from '../../src/client/lib/senet-reconcile';

/** Экран «Сверка Senet» (спецификация 2026-11-02-senet-autopost, §8.3; план, задача 14). */
describe('«Сверка Senet»', () => {
  it('вкладка видна, только если есть подключение', () => {
    expect(senetTabVisible([])).toBe(false);
    expect(senetTabVisible(undefined)).toBe(false);
    expect(senetTabVisible([{ archivedAt: '2026-10-01' }])).toBe(true);
  });

  it('смена: «01.10 10:00 — 22:00», у открытой — «идёт», через полночь — с датой конца', () => {
    expect(shiftPeriodLabel('2026-10-01T05:00:00.000Z', '2026-10-01T17:00:00.000Z', 'Asia/Almaty')).toBe('01.10 10:00 — 22:00');
    expect(shiftPeriodLabel('2026-10-01T17:01:00.000Z', '2026-10-02T05:00:00.000Z', 'Asia/Almaty')).toBe('01.10 22:01 — 02.10 10:00');
    expect(shiftPeriodLabel('2026-10-02T05:01:00.000Z', null, 'Asia/Almaty')).toBe('02.10 10:01 — идёт');
  });

  it('состояния словами', () => {
    expect(SHIFT_STATE_TEXT).toEqual({
      ok: 'Сходится',
      open: 'Идёт',
      not_posted: 'Не проводится',
      cash_diff: 'Касса расходится',
      review: 'Разобрать',
      changed: 'Senet изменил смену после проведения',
      deposit_mismatch: 'Внесение ≠ остаток прошлой смены',
    });
  });

  it('период по умолчанию — текущий месяц по часам клуба', () => {
    expect(defaultPeriod(new Date('2026-11-03T20:00:00.000Z'), 'Asia/Almaty')).toEqual({ from: '2026-11-01', to: '2026-11-30' });
  });
});
