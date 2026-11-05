import { describe, expect, it } from 'vitest';
import { clubApiParams, clubChanged, clubChoices, clubSearch, DEFAULT_CLUB_STATE, knownProject, parseClubSearch, resetClubState, withClubStep } from '../../src/client/lib/club-url';

/** Настройки отчётов клуба в адресе (спецификация «Аналитика клуба», §2.2; план АК-1, задача 7). */
const BY = ['parts', 'payment', 'shifts', 'cashiers'] as const;
const parse = (q: string) => parseClubSearch(new URLSearchParams(q), BY);

describe('адрес отчётов клуба', () => {
  it('пустой адрес — умолчания; умолчания в адресе не пишутся', () => {
    expect(parse('')).toEqual({ ...DEFAULT_CLUB_STATE, by: 'parts' });
    expect(clubSearch({ ...DEFAULT_CLUB_STATE, by: 'parts' }, BY).toString()).toBe('');
  });

  it('неверные значения — умолчания: клуб, разрез, вид, период', () => {
    const s = parse('project=abc&by=unknown&view=pie&period=forever');
    expect(s).toMatchObject({ project: null, by: 'parts', view: 'chart', period: 'year' });
    expect(parse('project=5&by=shifts&view=hours&compare=0').project).toBe(5);
  });

  it('свои даты — только оба поля; иначе год', () => {
    expect(parse('period=custom&from=2026-11-01&to=2026-11-30')).toMatchObject({ period: 'custom', from: '2026-11-01', to: '2026-11-30' });
    expect(parse('period=custom&from=2026-11-01').period).toBe('year');
    expect(parse('from=2026-11-30&to=2026-11-01')).toMatchObject({ period: 'custom', from: '2026-11-01', to: '2026-11-30' });
    const s = { ...DEFAULT_CLUB_STATE, by: 'parts' };
    expect(clubSearch({ ...s, period: 'custom', from: '2026-11-01', to: '2026-11-30' }, BY).toString()).toBe('from=2026-11-01&to=2026-11-30');
    expect(clubSearch({ ...s, period: 'custom' }, BY).toString()).toBe('');
    expect(clubSearch({ ...s, period: 'month', by: 'shifts' }, BY).toString()).toBe('period=month&by=shifts');
  });

  it('параметры API: период датами, действующий шаг, вид, клуб, сравнение', () => {
    const state = { ...DEFAULT_CLUB_STATE, by: 'parts', step: 'day' as const };
    const p = clubApiParams(state, '2026-11-04');
    expect(Object.fromEntries(p)).toEqual({ from: '2026-01-01', to: '2026-12-31', step: 'week', by: 'parts', view: 'table', compare: '1' });
    const q = clubApiParams({ ...state, view: 'hours', project: 7, compare: false, period: 'month' }, '2026-11-04');
    expect(Object.fromEntries(q)).toEqual({ from: '2026-11-01', to: '2026-11-30', step: 'day', by: 'parts', view: 'hours', project: '7', compare: '0' });
    expect(clubSearch({ ...state, view: 'hours', project: 7, compare: false }, BY).toString()).toBe('view=hours&step=day&project=7&compare=0');
  });

  it('клубы: без архивных; один клуб — выбора нет; неизвестный клуб из адреса — «Все клубы»', () => {
    const projects = [
      { id: 3, name: 'Клуб 3', archived: false },
      { id: 4, name: 'Клуб 4', archived: true },
      { id: 5, name: 'Клуб 5', archived: false },
    ];
    expect(clubChoices(projects).map((c) => c.label)).toEqual(['Все клубы', 'Клуб 3', 'Клуб 5']);
    expect(clubChoices(projects.slice(0, 2))).toEqual([]);
    const s = { ...DEFAULT_CLUB_STATE, by: 'parts' };
    expect(knownProject({ ...s, project: 4 }, projects).project).toBeNull();
    expect(knownProject({ ...s, project: 5 }, projects).project).toBe(5);
  });

  it('изменённые контролы, «Сбросить» и шаг под период', () => {
    const s = { ...DEFAULT_CLUB_STATE, by: 'parts', view: 'table' as const };
    const range = { from: '2026-01-01', to: '2026-12-31' };
    expect(Object.values(clubChanged(s, BY, range)).some(Boolean)).toBe(false);
    const changed = { ...s, project: 3, compare: false, by: 'shifts', period: 'month' as const, step: 'day' as const };
    expect(clubChanged(changed, BY, range)).toEqual({ project: true, period: true, step: true, compare: true, by: true });
    expect(resetClubState(changed, BY)).toEqual({ ...DEFAULT_CLUB_STATE, by: 'parts', view: 'table' });
    expect(withClubStep({ ...s, step: 'day' }, '2026-11-04').step).toBe('week');
    expect(withClubStep({ ...s, step: 'day', period: 'month' }, '2026-11-04').step).toBe('day');
  });
});
