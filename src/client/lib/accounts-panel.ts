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
