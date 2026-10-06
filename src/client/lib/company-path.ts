import type { Company } from './queries';

/** Тот же раздел у другой компании: /c/5/settings/accounts → /c/7/settings/accounts; вне компании — журнал. */
export function switchCompanyPath(pathname: string, companyId: number): string {
  return /^\/c\/\d+(\/|$)/.test(pathname) ? pathname.replace(/^\/c\/\d+/, `/c/${companyId}`) : `/c/${companyId}/log`;
}

/** Стартовая компания: последняя открытая, если она есть и не в архиве; иначе первая активная. */
export function pickStartCompany(companies: readonly Company[], lastId: unknown): Company | undefined {
  const active = companies.filter((c) => !c.archivedAt);
  return active.find((c) => c.id === lastId) ?? active[0];
}
