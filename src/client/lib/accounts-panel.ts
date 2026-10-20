import { formatMoney, MONEY_SCREEN_BEFORE } from '../../shared/money';
import { journalSearch, parseJournalSearch } from './journal-filter';
import type { Account, Project } from './queries';

export interface AccountGroup {
  key: string;
  title: string;
  items: Account[];
}

/** Группы левой панели (§7): «Общие», затем проекты в их порядке; архивные счета и пустые группы не показываются. */
export function groupAccounts(accounts: Account[], projects: Project[]): AccountGroup[] {
  const active = accounts.filter((a) => !a.archivedAt);
  return [
    { key: 'common', title: 'Общие', items: active.filter((a) => a.projectId === null) },
    ...projects.map((p) => ({ key: String(p.id), title: p.name, items: active.filter((a) => a.projectId === p.id) })),
  ].filter((g) => g.items.length > 0);
}

/** Клуб счёта для SettingsRow.group: «Общие» и каждый проект — свой круг перестановки. */
export const accountGroupKey = (account: Account): string => (account.projectId === null ? 'common' : String(account.projectId));

/**
 * Счета в порядке левой панели (общий источник для панели, окна «Счета» и раздела «Счета»): «Общие», затем клубы
 * в порядке проектов, внутри клуба — порядок сервера (orderIndex); активные счета клуба, которого нет в списке,
 * — после них; архивные — в конце в прежнем порядке.
 */
export function panelOrder(accounts: Account[], projects: Project[]): Account[] {
  const grouped = groupAccounts(accounts, projects).flatMap((g) => g.items);
  const shown = new Set(grouped.map((a) => a.id));
  return [
    ...grouped,
    ...accounts.filter((a) => !a.archivedAt && !shown.has(a.id)),
    ...accounts.filter((a) => a.archivedAt),
  ];
}

/** Серый текст строки раздела «Счета» (§7.4 этапа 1.5): «{Клуб} · ₸ 114 997»; у клуба в архиве — «{Клуб} (в архиве)»; у общего счёта — только баланс. */
export function accountSecondary(account: Account, projects: Project[], balance: number | undefined): string {
  const project = account.projectId === null ? undefined : projects.find((p) => p.id === account.projectId);
  const club = project ? (project.archivedAt ? `${project.name} (в архиве)` : project.name) : null;
  const money = balance === undefined ? null : formatMoney(balance, account.currency, MONEY_SCREEN_BEFORE);
  return [club, money].filter((s): s is string => s !== null).join(' · ');
}

/** Заголовки групп «Общие» / клубы показываются, только если групп больше одной (§7.6 этапа 1.5). */
export function showGroupTitles(groups: AccountGroup[]): boolean {
  return groups.length > 1;
}

/**
 * Ссылка счёта в левой панели: счёт, которого нет в фильтре открытого журнала, открывает журнал с фильтром только
 * по нему (`?account=5`); счёт, уже стоящий в фильтре, — выбран (подсвечен), и повторное нажатие снимает его
 * из фильтра, остальные условия журнала остаются.
 */
export function accountPanelLink(companyId: number, accountId: number, location: { pathname: string; search: string }): { to: string; selected: boolean } {
  const journal = `/c/${companyId}/log`;
  const state = location.pathname === journal ? parseJournalSearch(new URLSearchParams(location.search)) : null;
  if (!state?.accountIds.includes(accountId)) return { to: `${journal}?account=${accountId}`, selected: false };
  const rest = journalSearch({ ...state, accountIds: state.accountIds.filter((id) => id !== accountId) }).toString();
  return { to: rest ? `${journal}?${rest}` : journal, selected: true };
}
