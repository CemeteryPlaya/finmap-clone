import { and, asc, eq, isNull, sql, type SQL } from 'drizzle-orm';
import type { Db } from '../../db/client';
import { rows as sqlRows } from '../../db/raw';
import { accounts, operations } from '../../db/schema';

/** Баланс счёта (§4.7). Заглушка createBalancesService (баланс = стартовый остаток) — значение по умолчанию для модульных тестов. */
export interface BalancesService {
  accountBalance(account: { id: number; startingBalance: number }): Promise<number>;
}

export function createBalancesService(): BalancesService {
  return { accountBalance: async (a) => a.startingBalance };
}

export interface AccountBalance {
  accountId: number;
  currency: string;
  balance: number;
  archived: boolean;
}

export interface LedgerBalances extends BalancesService {
  /** Балансы всех счетов компании (включая архивные) в их валютах. */
  companyBalances(companyId: number): Promise<AccountBalance[]>;
  /**
   * Остаток счёта после операции (§4.7): оконная функция по полной истории счёта — фактические неудалённые
   * операции в порядке (paidAt, id), без учёта фильтров журнала. Ключ — `${operationId}:${accountId}`;
   * у перевода есть оба ключа. scope — только эти операции, окно — по полной истории этих счетов
   * (страница журнала); без scope — все операции компании (выгрузка).
   */
  balancesAfter(companyId: number, scope?: { operationIds: number[]; accountIds: number[] }): Promise<Map<string, number>>;
}

/**
 * Баланс = startingBalance + поступления - списания по фактическим неудалённым операциям (§4.7).
 * Перевод уменьшает исходный счёт на amount и увеличивает целевой на toAmount.
 */
export function createLedgerBalances(db: Db): LedgerBalances {
  async function movements(filter: { companyId?: number; accountId?: number }): Promise<Map<number, number>> {
    const scope: SQL[] = [isNull(operations.deletedAt), eq(operations.status, 'actual')];
    if (filter.companyId !== undefined) scope.push(eq(operations.companyId, filter.companyId));
    const outgoing = await db
      .select({
        accountId: operations.accountId,
        delta: sql<number>`sum(case when ${operations.type} = 'income' then ${operations.amount} else -${operations.amount} end)`,
      })
      .from(operations)
      .where(and(...scope, filter.accountId !== undefined ? eq(operations.accountId, filter.accountId) : undefined))
      .groupBy(operations.accountId);
    const incoming = await db
      .select({ accountId: operations.toAccountId, delta: sql<number>`sum(${operations.toAmount})` })
      .from(operations)
      .where(and(...scope, eq(operations.type, 'transfer'), filter.accountId !== undefined ? eq(operations.toAccountId, filter.accountId) : undefined))
      .groupBy(operations.toAccountId);
    const m = new Map<number, number>();
    for (const r of outgoing) m.set(r.accountId, (m.get(r.accountId) ?? 0) + Number(r.delta));
    for (const r of incoming) if (r.accountId !== null) m.set(r.accountId, (m.get(r.accountId) ?? 0) + Number(r.delta));
    return m;
  }

  return {
    async accountBalance(account) {
      return account.startingBalance + ((await movements({ accountId: account.id })).get(account.id) ?? 0);
    },

    async companyBalances(companyId) {
      const m = await movements({ companyId });
      return (await db.select().from(accounts).where(eq(accounts.companyId, companyId)).orderBy(asc(accounts.orderIndex), asc(accounts.id))).map((a) => ({ accountId: a.id, currency: a.currency, balance: a.startingBalance + (m.get(a.id) ?? 0), archived: a.archivedAt !== null }));
    },

    async balancesAfter(companyId, scope) {
      if (scope && (scope.operationIds.length === 0 || scope.accountIds.length === 0)) return new Map();
      const list = (ids: number[]) => sql.join(ids.map((x) => sql`${x}`), sql`, `);
      const fromScope = scope ? sql`AND account_id IN (${list(scope.accountIds)})` : sql.empty();
      const toScope = scope ? sql`AND to_account_id IN (${list(scope.accountIds)})` : sql.empty();
      const only = scope ? sql`WHERE r.op_id IN (${list(scope.operationIds)})` : sql.empty();
      // каждая операция — «нога» по счёту операции (доход — приход, иначе списание), перевод — ещё нога по счёту зачисления
      const rows = await sqlRows<{ operationId: number; accountId: number; balance: number }>(
        db,
        sql`
        WITH legs AS (
          SELECT id AS op_id, paid_at, account_id, CASE WHEN type = 'income' THEN amount ELSE -amount END AS delta
            FROM operations
           WHERE company_id = ${companyId} AND deleted_at IS NULL AND status = 'actual' ${fromScope}
          UNION ALL
          SELECT id, paid_at, to_account_id, to_amount
            FROM operations
           WHERE company_id = ${companyId} AND deleted_at IS NULL AND status = 'actual' AND type = 'transfer' ${toScope}
        ),
        running AS (
          SELECT op_id, account_id,
                 SUM(delta) OVER (PARTITION BY account_id ORDER BY paid_at, op_id ROWS UNBOUNDED PRECEDING) AS run
            FROM legs
        )
        SELECT r.op_id AS operationId, r.account_id AS accountId, a.starting_balance + r.run AS balance
          FROM running r JOIN accounts a ON a.id = r.account_id
        ${only}`,
      );
      return new Map(rows.map((r) => [`${r.operationId}:${r.accountId}`, Number(r.balance)]));
    },
  };
}
