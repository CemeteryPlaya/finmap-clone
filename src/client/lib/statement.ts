import { DEFAULT_REPORT_STATE, reportRange, type ReportUrlState } from './report-url';

/**
 * «Выписка по счету» (§6 спецификации «Аналитика»): из настроек отчёта в адресе действуют только период и счёт (первый
 * `account`). Счёт — одиночный выбор: остальное из адреса отбрасывается, поэтому «Сбросить» и точки считаются по периоду.
 */
export function statementState(s: ReportUrlState): ReportUrlState {
  return { ...DEFAULT_REPORT_STATE, period: s.period, ...(s.period === 'custom' ? { from: s.from, to: s.to } : {}), accountIds: s.accountIds.slice(0, 1) };
}

interface AccountLike {
  id: number;
  name: string;
  archivedAt: string | null;
}

/**
 * Счёт выписки: выбранный в адресе — даже архивный (его открыли явно, ссылкой или из списка счетов); без выбора — первый
 * неархивный по порядку счетов. Нет ни того, ни другого — null.
 */
export function statementAccountId(state: Pick<ReportUrlState, 'accountIds'>, accounts: readonly AccountLike[]): number | null {
  const chosen = state.accountIds[0];
  if (chosen !== undefined && accounts.some((a) => a.id === chosen)) return chosen;
  return accounts.find((a) => a.archivedAt === null)?.id ?? null;
}

/** Пункты меню «Счёт»: неархивные по порядку; архивный — только выбранный (из адреса), с пометкой «(архив)». */
export function statementAccountChoices(accounts: readonly AccountLike[], current: number | null): { value: string; label: string }[] {
  return accounts.filter((a) => a.archivedAt === null || a.id === current).map((a) => ({ value: String(a.id), label: a.archivedAt ? `${a.name} (архив)` : a.name }));
}

/** Параметры API выписки (§9): счёт и период датами. */
export function statementApiParams(state: ReportUrlState, accountId: number, today: string): URLSearchParams {
  const range = reportRange(state, today);
  return new URLSearchParams({ account: String(accountId), from: range.from, to: range.to });
}

/** Ссылка «Excel» выписки (§2.6): тот же счёт и период. */
export function statementExcelHref(companyId: number, state: ReportUrlState, accountId: number, today: string): string {
  return `/api/v1/companies/${companyId}/analytics/statement.xlsx?${statementApiParams(state, accountId, today).toString()}`;
}
