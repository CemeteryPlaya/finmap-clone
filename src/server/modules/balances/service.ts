import { and, asc, eq, isNull, sql, type SQL } from 'drizzle-orm';
import type { Db } from '../../db/client';
import { accounts, operations } from '../../db/schema';

/** Баланс счёта (§4.7). До шага 4 операций нет — баланс равен стартовому остатку. */
export interface BalancesService {
  accountBalance(account: { id: number; startingBalance: number }): number;
}

export function createBalancesService(): BalancesService {
  return { accountBalance: (a) => a.startingBalance };
}

export interface AccountBalance {
  accountId: number;
  currency: string;
  balance: number;
  archived: boolean;
}

export interface LedgerBalances extends BalancesService {
  /** Балансы всех счетов компании (включая архивные) в их валютах. */
  companyBalances(companyId: number): AccountBalance[];
}

/**
 * Баланс = startingBalance + поступления - списания по фактическим неудалённым операциям (§4.7).
 * Перевод уменьшает исходный счёт на amount и увеличивает целевой на toAmount.
 */
export function createLedgerBalances(db: Db): LedgerBalances {
  function movements(filter: { companyId?: number; accountId?: number }): Map<number, number> {
    const scope: SQL[] = [isNull(operations.deletedAt), eq(operations.status, 'actual')];
    if (filter.companyId !== undefined) scope.push(eq(operations.companyId, filter.companyId));
    const outgoing = db
      .select({
        accountId: operations.accountId,
        delta: sql<number>`sum(case when ${operations.type} = 'income' then ${operations.amount} else -${operations.amount} end)`,
      })
      .from(operations)
      .where(and(...scope, filter.accountId !== undefined ? eq(operations.accountId, filter.accountId) : undefined))
      .groupBy(operations.accountId)
      .all();
    const incoming = db
      .select({ accountId: operations.toAccountId, delta: sql<number>`sum(${operations.toAmount})` })
      .from(operations)
      .where(and(...scope, eq(operations.type, 'transfer'), filter.accountId !== undefined ? eq(operations.toAccountId, filter.accountId) : undefined))
      .groupBy(operations.toAccountId)
      .all();
    const m = new Map<number, number>();
    for (const r of outgoing) m.set(r.accountId, (m.get(r.accountId) ?? 0) + Number(r.delta));
    for (const r of incoming) if (r.accountId !== null) m.set(r.accountId, (m.get(r.accountId) ?? 0) + Number(r.delta));
    return m;
  }

  return {
    accountBalance(account) {
      return account.startingBalance + (movements({ accountId: account.id }).get(account.id) ?? 0);
    },

    companyBalances(companyId) {
      const m = movements({ companyId });
      return db
        .select()
        .from(accounts)
        .where(eq(accounts.companyId, companyId))
        .orderBy(asc(accounts.orderIndex), asc(accounts.id))
        .all()
        .map((a) => ({ accountId: a.id, currency: a.currency, balance: a.startingBalance + (m.get(a.id) ?? 0), archived: a.archivedAt !== null }));
    },
  };
}
