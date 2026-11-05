import { describe, expect, it } from 'vitest';
import { delta } from '../../src/shared/club-analytics/delta';

/** Δ к прошлому периоду (спецификация «Аналитика клуба», §2.2; план АК-1, задача 7). */
describe('Δ к прошлому периоду', () => {
  it('суммы и средние — проценты с округлением до целого; минус — U+2212', () => {
    expect(delta(112, 100, 'sum', false)).toEqual({ text: '+12 %', tone: 'up' });
    expect(delta(95, 100, 'avg', false)).toEqual({ text: '−5 %', tone: 'down' });
    expect(delta(100, 100, 'sum', false)).toEqual({ text: '0 %', tone: 'flat' });
    expect(delta(1004, 1000, 'sum', false)).toEqual({ text: '0 %', tone: 'flat' });
  });

  it('доли — процентные пункты; Δ сумм при неполных данных — с «≈»', () => {
    expect(delta(0.43, 0.4, 'share', false)).toEqual({ text: '+3 п. п.', tone: 'up' });
    expect(delta(0.4, 0.43, 'share', true)).toEqual({ text: '−3 п. п.', tone: 'down' });
    expect(delta(112, 100, 'sum', true)!.text).toBe('≈ +12 %');
    expect(delta(112, 100, 'avg', true)!.text).toBe('+12 %');
  });

  it('прошлого нет или он ноль — Δ нет', () => {
    expect(delta(5, null, 'sum', false)).toBeNull();
    expect(delta(null, 5, 'sum', false)).toBeNull();
    expect(delta(5, 0, 'sum', false)).toBeNull();
    expect(delta(0.2, 0, 'share', false)).toEqual({ text: '+20 п. п.', tone: 'up' });
  });
});
