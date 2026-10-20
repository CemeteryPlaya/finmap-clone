import { describe, expect, it } from 'vitest';
import { accountGroupKey, accountPanelLink, accountSecondary, groupAccounts, panelOrder, showGroupTitles } from '../../src/client/lib/accounts-panel';
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
    // клуб в архиве — пометка в тексте строки
    expect(accountSecondary(account(5, 11), [{ ...project(11, 'Старый'), archivedAt: '2026-10-02T00:00:00.000Z' }], undefined)).toBe('Старый (в архиве)');
    expect(accountSecondary(account(4, null), projects, undefined)).toBe('');
  });
});

describe('panelOrder — порядок панели для окна «Счета» и раздела «Счета» (R6)', () => {
  const projects = [project(20, 'Клуб 2'), project(10, 'Клуб 1')];

  it('«Общие», клубы в порядке проектов, внутри клуба — порядок сервера; архивные и счета неизвестного клуба — в конце', () => {
    const accounts = [account(1, 10), account(2, 20), account(3, null), account(4, 10), account(5, null, true), account(6, 99), account(7, 20)];
    expect(panelOrder(accounts, projects).map((a) => a.id)).toEqual([3, 2, 7, 1, 4, 6, 5]);
  });

  it('тот же порядок активных счетов, что показывает панель', () => {
    const accounts = [account(1, 10), account(2, 20), account(3, null), account(4, 10)];
    expect(panelOrder(accounts, projects).map((a) => a.id)).toEqual(groupAccounts(accounts, projects).flatMap((g) => g.items.map((a) => a.id)));
  });

  it('accountGroupKey — «Общие» и каждый проект отдельно', () => {
    expect(accountGroupKey(account(1, null))).toBe('common');
    expect(accountGroupKey(account(2, 10))).toBe('10');
  });
});

describe('showGroupTitles — заголовки групп в «Моих счетах» (§7.6 этапа 1.5)', () => {
  it('одна группа — без заголовка, как плоский список Finmap; две и больше — с заголовками', () => {
    expect(showGroupTitles(groupAccounts([account(1, null), account(2, null)], []))).toBe(false);
    expect(showGroupTitles(groupAccounts([account(1, 10)], [project(10, 'Клуб 1')]))).toBe(false);
    expect(showGroupTitles(groupAccounts([account(1, null), account(2, 10)], [project(10, 'Клуб 1')]))).toBe(true);
  });
});

describe('accountPanelLink: счёт левой панели — фильтр журнала по нажатию, повторное нажатие снимает', () => {
  const at = (pathname: string, search = '') => ({ pathname, search });

  it('счёта нет в фильтре — журнал только с ним, не выбран', () => {
    expect(accountPanelLink(1, 5, at('/c/1/log'))).toEqual({ to: '/c/1/log?account=5', selected: false });
    expect(accountPanelLink(1, 5, at('/c/1/log', '?account=7&sort=amount'))).toEqual({ to: '/c/1/log?account=5', selected: false });
  });

  it('не в журнале (настройки, аналитика с тем же ключом) — счёт не выбран', () => {
    expect(accountPanelLink(1, 5, at('/c/1/analytics/statement', '?account=5'))).toEqual({ to: '/c/1/log?account=5', selected: false });
    expect(accountPanelLink(1, 5, at('/c/2/log', '?account=5'))).toEqual({ to: '/c/1/log?account=5', selected: false });
  });

  it('счёт в фильтре — выбран, ссылка снимает только его, прочие условия остаются', () => {
    expect(accountPanelLink(1, 5, at('/c/1/log', '?account=5'))).toEqual({ to: '/c/1/log', selected: true });
    expect(accountPanelLink(1, 5, at('/c/1/log', '?period=month&account=5&account=7&sort=amount&order=asc'))).toEqual({
      to: '/c/1/log?period=month&account=7&sort=amount&order=asc',
      selected: true,
    });
  });
});
