import { describe, expect, it } from 'vitest';
import { defaultAccounts, lastAccountKey, parseLastAccounts, withSaved } from '../../src/client/lib/last-account';

const ARCH = '2026-10-01T00:00:00.000Z';
const accounts = [
  { id: 1, archivedAt: null },
  { id: 2, archivedAt: null },
  { id: 3, archivedAt: ARCH },
];

describe('последний выбранный счёт (§6.2 этапа 1.5)', () => {
  it('ключ — пользователь и компания', () => {
    expect(lastAccountKey(7, 12)).toBe('fc.lastAccount.7.12');
  });

  it('разбор: только положительные целые id известных полей; повреждённое или чужое — пусто (Review Focus 4)', () => {
    expect(parseLastAccounts(null)).toEqual({});
    expect(parseLastAccounts('не json')).toEqual({});
    expect(parseLastAccounts('[1,2]')).toEqual({});
    expect(parseLastAccounts('{"income":1,"expense":"2","transferFrom":-3,"transferTo":2.5,"x":4}')).toEqual({ income: 1 });
    expect(parseLastAccounts('{"income":1,"expense":2,"transferFrom":1,"transferTo":2}')).toEqual({ income: 1, expense: 2, transferFrom: 1, transferTo: 2 });
  });

  it('запоминание: у дохода и расхода — свой счёт, у перевода — оба', () => {
    expect(withSaved({ income: 1 }, 'expense', 2, null)).toEqual({ income: 1, expense: 2 });
    expect(withSaved({ expense: 2 }, 'transfer', 1, 2)).toEqual({ expense: 2, transferFrom: 1, transferTo: 2 });
  });

  it('подстановка: запомненный счёт, если он есть и не в архиве; иначе пусто, как в Finmap', () => {
    const last = { income: 1, expense: 3, transferFrom: 2, transferTo: 99 };
    expect(defaultAccounts('income', last, accounts)).toEqual({ accountId: 1, toAccountId: null });
    expect(defaultAccounts('expense', last, accounts)).toEqual({ accountId: null, toAccountId: null });
    expect(defaultAccounts('transfer', last, accounts)).toEqual({ accountId: 2, toAccountId: null });
    expect(defaultAccounts('income', {}, accounts)).toEqual({ accountId: null, toAccountId: null });
  });
});
