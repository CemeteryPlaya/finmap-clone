import { formatMoney, MONEY_SCREEN_BEFORE } from '../../shared/money';
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

/** Серый текст строки раздела «Счета» (§7.4 этапа 1.5): «{Клуб} · ₸ 114 997»; у общего счёта — только баланс. */
export function accountSecondary(account: Account, projects: Project[], balance: number | undefined): string {
  const club = account.projectId === null ? null : (projects.find((p) => p.id === account.projectId)?.name ?? null);
  const money = balance === undefined ? null : formatMoney(balance, account.currency, MONEY_SCREEN_BEFORE);
  return [club, money].filter((s): s is string => s !== null).join(' · ');
}

/** Заголовки групп «Общие» / клубы показываются, только если групп больше одной (§7.6 этапа 1.5). */
export function showGroupTitles(groups: AccountGroup[]): boolean {
  return groups.length > 1;
}
