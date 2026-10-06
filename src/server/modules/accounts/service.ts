import { and, asc, count, eq, isNull, sql } from 'drizzle-orm';
import { isKnownCurrency } from '../../../shared/currencies';
import type { Db, Executor } from '../../db/client';
import { accounts, projects } from '../../db/schema';
import { AppError } from '../../errors';

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
/** Название счёта шаблона = префикс + название проекта (до 100), поэтому лимит с запасом. */
export const ACCOUNT_NAME_MAX = 120;

export interface AccountRow {
  id: number;
  companyId: number;
  projectId: number | null;
  name: string;
  currency: string;
  startingBalance: number;
  openedAt: string;
  orderIndex: number;
  createdAt: string;
  archivedAt: string | null;
}

export interface AccountsService {
  create(
    ex: Executor,
    input: { companyId: number; projectId?: number | null; name: string; currency: string; startingBalance?: number; openedAt: string },
  ): AccountRow;
  list(companyId: number): AccountRow[];
  countActive(companyId: number, projectId?: number): number;
}

export function createAccountsService(db: Db, now: () => Date = () => new Date()): AccountsService {
  return {
    create(ex, input) {
      const name = input.name.trim();
      const startingBalance = input.startingBalance ?? 0;
      const fields: Record<string, string> = {};
      if (name.length < 1 || name.length > ACCOUNT_NAME_MAX) fields.name = `Название счёта: от 1 до ${ACCOUNT_NAME_MAX} символов`;
      if (!isKnownCurrency(input.currency)) fields.currency = 'Неизвестная валюта';
      if (!Number.isSafeInteger(startingBalance)) fields.startingBalance = 'Стартовый баланс — целое число минимальных единиц';
      if (!DATE_RE.test(input.openedAt)) fields.openedAt = 'Дата открытия в формате ГГГГ-ММ-ДД';
      if (input.projectId != null) {
        const p = ex.select({ companyId: projects.companyId }).from(projects).where(eq(projects.id, input.projectId)).get();
        if (!p || p.companyId !== input.companyId) fields.projectId = 'Проект не найден в этой компании';
      }
      if (Object.keys(fields).length) throw new AppError(400, 'VALIDATION', 'Проверьте заполнение полей', fields);

      const next = ex
        .select({ m: sql<number>`coalesce(max(${accounts.orderIndex}), -1)` })
        .from(accounts)
        .where(eq(accounts.companyId, input.companyId))
        .get();
      return ex
        .insert(accounts)
        .values({
          companyId: input.companyId,
          projectId: input.projectId ?? null,
          name,
          currency: input.currency,
          startingBalance,
          openedAt: input.openedAt,
          orderIndex: (next?.m ?? -1) + 1,
          createdAt: now().toISOString(),
        })
        .returning()
        .get();
    },

    list(companyId) {
      return db.select().from(accounts).where(eq(accounts.companyId, companyId)).orderBy(asc(accounts.orderIndex), asc(accounts.id)).all();
    },

    countActive(companyId, projectId) {
      const conds = [eq(accounts.companyId, companyId), isNull(accounts.archivedAt)];
      if (projectId !== undefined) conds.push(eq(accounts.projectId, projectId));
      return db.select({ n: count() }).from(accounts).where(and(...conds)).get()?.n ?? 0;
    },
  };
}
