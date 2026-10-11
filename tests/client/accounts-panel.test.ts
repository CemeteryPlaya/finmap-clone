import { describe, expect, it } from 'vitest';
import { accountSecondary, groupAccounts, showGroupTitles } from '../../src/client/lib/accounts-panel';
import type { Account, Project } from '../../src/client/lib/queries';

const account = (id: number, projectId: number | null, archived = false): Account => ({
  id,
  companyId: 1,
  projectId,
  name: `Счёт ${id}`,
  currency: 'KZT',
  startingBalance: 0,
  openedAt: '2026-10-01',
  orderIndex: id,
  createdAt: '2026-10-01T00:00:00.000Z',
  archivedAt: archived ? '2026-10-02T00:00:00.000Z' : null,
  hasOperations: false,
});
const project = (id: number, name: string): Project => ({
  id,
  companyId: 1,
  name,
  templateKey: 'general',
  templateParams: {},
  orderIndex: id,
  createdAt: '2026-10-01T00:00:00.000Z',
  archivedAt: null,
});

describe('groupAccounts', () => {
  it('«Общие», затем проекты в их порядке; архивные счета и пустые группы скрыты', () => {
    const groups = groupAccounts(
      [account(1, 20), account(2, null), account(3, 10), account(4, null, true), account(5, 30, true)],
      [project(20, 'Клуб 2'), project(10, 'Клуб 1'), project(30, 'Склад')],
    );
    expect(groups.map((g) => [g.title, g.items.map((a) => a.id)])).toEqual([
      ['Общие', [2]],
      ['Клуб 2', [1]],
      ['Клуб 1', [3]],
    ]);
  });

  it('нет активных счетов — нет групп', () => {
    expect(groupAccounts([account(1, null, true)], [])).toEqual([]);
  });
});

describe('accountSecondary — серый текст строки раздела «Счета» (§7.4 этапа 1.5)', () => {
  it('«{Клуб} · ₸ 114 997»; у общего счёта — только баланс; баланс ещё не загружен — только клуб', () => {
    const projects = [project(10, 'Клуб 1')];
    expect(accountSecondary(account(1, 10), projects, 11499700)).toBe('Клуб 1 · ₸\u00A0114\u202F997');
    expect(accountSecondary(account(2, null), projects, -50050)).toBe('\u2212₸\u00A0500,50');
    expect(accountSecondary(account(3, 10), projects, undefined)).toBe('Клуб 1');
    expect(accountSecondary(account(4, null), projects, undefined)).toBe('');
  });
});

describe('showGroupTitles — заголовки групп в «Моих счетах» (§7.6 этапа 1.5)', () => {
  it('одна группа — без заголовка, как плоский список Finmap; две и больше — с заголовками', () => {
    expect(showGroupTitles(groupAccounts([account(1, null), account(2, null)], []))).toBe(false);
    expect(showGroupTitles(groupAccounts([account(1, 10)], [project(10, 'Клуб 1')]))).toBe(false);
    expect(showGroupTitles(groupAccounts([account(1, null), account(2, 10)], [project(10, 'Клуб 1')]))).toBe(true);
  });
});
