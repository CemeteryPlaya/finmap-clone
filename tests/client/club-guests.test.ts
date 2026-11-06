import { describe, expect, it } from 'vitest';
import { cohortMonthText, shareText, sortGuests, unassignedText, visitTimeText, type GuestRowView } from '../../src/client/lib/club-guests';

const row = (ref: string, over: Partial<GuestRowView> = {}): GuestRowView => ({
  ref,
  logins: [ref],
  masks: [],
  visits: 1,
  visitSec: 3600,
  spent: 0,
  refilled: 0,
  firstVisit: '2026-11-01T10:00:00.000Z',
  lastVisit: '2026-11-01T10:00:00.000Z',
  ...over,
});

describe('sortGuests', () => {
  const rows = [row('b', { visits: 3 }), row('a', { visits: 1 }), row('c', { visits: 3 })];

  it('по числу: по возрастанию и убыванию; равные — в исходном порядке', () => {
    expect(sortGuests(rows, 'visits', 'asc').map((r) => r.ref)).toEqual(['a', 'b', 'c']);
    expect(sortGuests(rows, 'visits', 'desc').map((r) => r.ref)).toEqual(['b', 'c', 'a']);
  });

  it('по логинам — по первому логину, кириллица раньше латиницы', () => {
    const named = [row('1', { logins: ['zed'] }), row('2', { logins: ['анна'] }), row('3', { logins: ['bob', 'анна'] })];
    expect(sortGuests(named, 'logins', 'asc').map((r) => r.ref)).toEqual(['2', '3', '1']);
  });

  it('исходный список не меняется', () => {
    sortGuests(rows, 'visits', 'asc');
    expect(rows.map((r) => r.ref)).toEqual(['b', 'a', 'c']);
  });
});

describe('visitTimeText', () => {
  const t = (local: string) => new Date(`${local}:00+05:00`).toISOString();
  it('визит в один день и через полночь — по часам клуба', () => {
    expect(visitTimeText(t('2026-11-03T20:05'), t('2026-11-03T23:40'), 'Asia/Almaty')).toBe('03.11 20:05–23:40');
    expect(visitTimeText(t('2026-11-03T23:30'), t('2026-11-04T01:10'), 'Asia/Almaty')).toBe('03.11 23:30–04.11 01:10');
  });
});

describe('подписи «Гостей»', () => {
  it('месяц когорты и доля', () => {
    expect(cohortMonthText('2026-10')).toBe('окт 2026');
    expect(cohortMonthText('2027-01')).toBe('янв 2027');
    expect(shareText(0.5)).toBe('50 %');
    expect(shareText(0.333)).toBe('33,3 %');
  });

  it('сеансы без гостя и общих логинов: нулевые части не показываются', () => {
    expect(unassignedText({ noGuest: 2, shared: 0 })).toBe('Без гостя: 2 сеанса');
    expect(unassignedText({ noGuest: 5, shared: 1 })).toBe('Без гостя: 5 сеансов · Общие логины: 1 сеанс');
    expect(unassignedText({ noGuest: 0, shared: 0 })).toBeNull();
  });
});
