import { describe, expect, it } from 'vitest';
import { durationText, hourLabel, loadText, parseSeats, seatsLine } from '../../src/client/lib/club-load';

/** «Загрузка» — подписи (спецификация «Аналитика клуба», §6; план АК-2, задача 6). */
describe('подписи «Загрузки»', () => {
  it('загрузка — процент с одним знаком; нет данных', () => {
    expect(loadText(0.425)).toBe('42,5 %');
    expect(loadText(0.94)).toBe('94 %');
    expect(loadText(null)).toBe('нет данных');
  });

  it('«В расчёте» — ПК и места зон (§6.1)', () => {
    const zones = [
      { label: 'Общий зал', seats: 30 },
      { label: 'VIP', seats: 10 },
    ];
    expect(seatsLine({ total: 40, zones, note: null })).toBe('В расчёте: 40 ПК (Общий зал 30, VIP 10)');
    expect(seatsLine({ total: 40, zones: [], note: null })).toBe('В расчёте: 40 ПК');
  });

  it('час недели — «Пт 20:00–21:00 — 94 %»', () => {
    expect(hourLabel({ weekday: 4, hour: 20, value: 0.94 })).toBe('Пт 20:00–21:00 — 94 %');
    expect(hourLabel({ weekday: 6, hour: 23, value: 0 })).toBe('Вс 23:00–24:00 — 0 %');
  });

  it('длительность — «1 ч 25 мин»', () => {
    expect(durationText(5_100)).toBe('1 ч 25 мин');
    expect(durationText(1_800)).toBe('30 мин');
    expect(durationText(7_200)).toBe('2 ч');
    expect(durationText(null)).toBe('—');
  });
});

describe('parseSeats', () => {
  it('поле «Своё число ПК»: пусто — по данным; целое 1–1000; иначе — ошибка', () => {
    expect(parseSeats('')).toEqual({ seats: null });
    expect(parseSeats('  ')).toEqual({ seats: null });
    expect(parseSeats(' 12 ')).toEqual({ seats: 12 });
    for (const bad of ['0', '1001', '1,5', 'abc', '-3']) expect(parseSeats(bad)).toEqual({ error: 'От 1 до 1000' });
  });
});
