import { and, asc, count, eq, isNull, sql } from 'drizzle-orm';
import { isKnownCurrency } from '../../../shared/currencies';
import { formatDateRu, isValidDate, todayInTimezone } from '../../../shared/dates';
import { ACCOUNT_NAME_MAX } from '../../../shared/schemas/accounts';
import { cleanName } from '../../../shared/text';
import type { Db, Executor } from '../../db/client';
import { first } from '../../db/raw';
import { accounts, projects } from '../../db/schema';
import { AppError } from '../../errors';
import { changedFields, mutateAsync } from '../audit/mutate';
import type { AuditService } from '../audit/service';
import { createBalancesService, type BalancesService } from '../balances/service';
import { requireCompany } from '../companies/guard';
import { assertSameSet, isSameOrder } from '../dictionaries/order';
import { createReferencesService, type ReferencesService } from '../references/service';

export { ACCOUNT_NAME_MAX };

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

export interface AccountInput {
  name: string;
  currency: string;
  startingBalance?: number;
  /** По умолчанию — сегодня в APP_TIMEZONE. */
  openedAt?: string;
  projectId?: number | null;
}

export interface AccountPatch {
  name?: string;
  currency?: string;
  startingBalance?: number;
  openedAt?: string;
  projectId?: number | null;
}

export interface AccountsService {
  /** Низкоуровневое создание внутри чужой транзакции (применение шаблона); историю пишет вызывающий. */
  create(
    ex: Executor,
    input: { companyId: number; projectId?: number | null; name: string; currency: string; startingBalance?: number; openedAt: string },
  ): Promise<AccountRow>;
  list(companyId: number): Promise<AccountRow[]>;
  countActive(companyId: number, projectId?: number): Promise<number>;
  /** Все счета проекта, включая архивные (удаление проекта). */
  countByProject(companyId: number, projectId: number): Promise<number>;
  add(companyId: number, input: AccountInput, userId: number): Promise<AccountRow>;
  update(companyId: number, id: number, input: AccountPatch, userId: number): Promise<AccountRow>;
  archive(companyId: number, id: number, userId: number): Promise<AccountRow>;
  unarchive(companyId: number, id: number, userId: number): Promise<AccountRow>;
  reorder(companyId: number, ids: number[], userId: number): Promise<AccountRow[]>;
  remove(companyId: number, id: number, userId: number): Promise<void>;
}

export function createAccountsService(d: {
  db: Db;
  audit: AuditService;
  references?: ReferencesService;
  balances?: BalancesService;
  timezone: string;
  now?: () => Date;
}): AccountsService {
  const { db, audit } = d;
  const now = d.now ?? (() => new Date());
  const references = d.references ?? createReferencesService();
  const balances = d.balances ?? createBalancesService();

  /** Поля счёта; проект — той же компании, новый выбор архивного проекта запрещён (инвариант 7). */
  async function validate(ex: Executor, companyId: number, v: AccountPatch): Promise<void> {
    const fields: Record<string, string> = {};
    if (v.name !== undefined && (v.name.length < 1 || v.name.length > ACCOUNT_NAME_MAX)) {
      fields.name = `Название счёта: от 1 до ${ACCOUNT_NAME_MAX} символов`;
    }
    if (v.currency !== undefined && !isKnownCurrency(v.currency)) fields.currency = 'Неизвестная валюта';
    if (v.startingBalance !== undefined && !Number.isSafeInteger(v.startingBalance)) {
      fields.startingBalance = 'Стартовый баланс — целое число минимальных единиц';
    }
    if (v.openedAt !== undefined && !isValidDate(v.openedAt)) fields.openedAt = 'Неверная дата открытия (ГГГГ-ММ-ДД)';
    let archivedProject = false;
    if (v.projectId !== undefined && v.projectId !== null) {
      const p = await first(ex.select({ companyId: projects.companyId, archivedAt: projects.archivedAt }).from(projects).where(eq(projects.id, v.projectId)));
      if (!p || p.companyId !== companyId) fields.projectId = 'Проект не найден в этой компании';
      else if (p.archivedAt) archivedProject = true;
    }
    if (Object.keys(fields).length) throw new AppError(400, 'VALIDATION', 'Проверьте заполнение полей', fields);
    if (archivedProject) throw new AppError(422, 'ARCHIVED_REFERENCE', 'Проект в архиве — выберите другой');
  }

  async function requireAccount(companyId: number, id: number): Promise<AccountRow> {
    const row = await first(db.select().from(accounts).where(and(eq(accounts.id, id), eq(accounts.companyId, companyId))));
    if (!row) throw new AppError(404, 'NOT_FOUND', 'Счёт не найден');
    return row;
  }

  const svc: AccountsService = {
    async create(ex, input) {
      const name = cleanName(input.name);
      const startingBalance = input.startingBalance ?? 0;
      await validate(ex, input.companyId, { name, currency: input.currency, startingBalance, openedAt: input.openedAt, projectId: input.projectId ?? null });
      const next = await first(
        ex
          .select({ m: sql<number>`coalesce(max(${accounts.orderIndex}), -1)` })
          .from(accounts)
          .where(eq(accounts.companyId, input.companyId)),
      );
      const [row] = await ex
        .insert(accounts)
        .values({
          companyId: input.companyId,
          projectId: input.projectId ?? null,
          name,
          currency: input.currency,
          startingBalance,
          openedAt: input.openedAt,
          orderIndex: Number(next?.m ?? -1) + 1,
          createdAt: now().toISOString(),
        })
        .returning();
      return row!;
    },

    list(companyId) {
      return db.select().from(accounts).where(eq(accounts.companyId, companyId)).orderBy(asc(accounts.orderIndex), asc(accounts.id));
    },

    async countActive(companyId, projectId) {
      const conds = [eq(accounts.companyId, companyId), isNull(accounts.archivedAt)];
      if (projectId !== undefined) conds.push(eq(accounts.projectId, projectId));
      return Number((await first(db.select({ n: count() }).from(accounts).where(and(...conds))))?.n ?? 0);
    },

    async countByProject(companyId, projectId) {
      return Number((await first(db.select({ n: count() }).from(accounts).where(and(eq(accounts.companyId, companyId), eq(accounts.projectId, projectId)))))?.n ?? 0);
    },

    async add(companyId, input, userId) {
      await requireCompany(db, companyId, { writable: true });
      return mutateAsync(db, audit, async (tx, record) => {
        const row = await svc.create(tx, {
          companyId,
          name: input.name,
          currency: input.currency,
          startingBalance: input.startingBalance,
          openedAt: input.openedAt ?? todayInTimezone(d.timezone, now()),
          projectId: input.projectId ?? null,
        });
        await record({
          companyId,
          userId,
          entity: 'account',
          entityId: row.id,
          action: 'create',
          diff: { name: row.name, currency: row.currency, startingBalance: row.startingBalance, openedAt: row.openedAt, projectId: row.projectId },
        });
        return row;
      });
    },

    async update(companyId, id, input, userId) {
      await requireCompany(db, companyId, { writable: true });
      const before = await requireAccount(companyId, id);
      if (before.archivedAt) throw new AppError(422, 'ARCHIVED_REFERENCE', 'Счёт в архиве — сначала верните его из архива');
      const patch: AccountPatch = { ...input, ...(input.name !== undefined ? { name: cleanName(input.name) } : {}) };
      const changes = changedFields(
        { name: before.name, currency: before.currency, startingBalance: before.startingBalance, openedAt: before.openedAt, projectId: before.projectId },
        patch,
      );
      if (!changes) return before;
      const after = changes.after;
      await validate(db, companyId, after);
      if (after.currency !== undefined && (await references.countOperations('account', id)) > 0) {
        throw new AppError(422, 'CURRENCY_LOCKED', 'По счёту есть операции — валюту изменить нельзя');
      }
      if (after.openedAt !== undefined) {
        const earliest = await references.earliestOperationDate(id);
        if (earliest !== null && after.openedAt > earliest) {
          throw new AppError(422, 'INVARIANT_6', `Есть операции от ${formatDateRu(earliest)} — дата открытия не может быть позже`);
        }
      }
      return mutateAsync(db, audit, async (tx, record) => {
        const [row] = await tx.update(accounts).set(after).where(eq(accounts.id, id)).returning();
        await record({ companyId, userId, entity: 'account', entityId: id, action: 'update', diff: changes });
        return row!;
      });
    },

    async archive(companyId, id, userId) {
      await requireCompany(db, companyId, { writable: true });
      const row = await requireAccount(companyId, id);
      if (row.archivedAt) return row;
      if ((await balances.accountBalance(row)) !== 0) {
        throw new AppError(422, 'ARCHIVED_REFERENCE', 'Счёт можно перевести в архив только при нулевом балансе');
      }
      return mutateAsync(db, audit, async (tx, record) => {
        const [out] = await tx.update(accounts).set({ archivedAt: now().toISOString() }).where(eq(accounts.id, id)).returning();
        await record({ companyId, userId, entity: 'account', entityId: id, action: 'archive' });
        return out!;
      });
    },

    async unarchive(companyId, id, userId) {
      await requireCompany(db, companyId, { writable: true });
      const row = await requireAccount(companyId, id);
      if (!row.archivedAt) return row;
      if (row.projectId !== null) {
        const p = await first(db.select({ archivedAt: projects.archivedAt }).from(projects).where(eq(projects.id, row.projectId)));
        if (p?.archivedAt) throw new AppError(422, 'ARCHIVED_REFERENCE', 'Проект счёта в архиве — сначала верните проект');
      }
      return mutateAsync(db, audit, async (tx, record) => {
        const [out] = await tx.update(accounts).set({ archivedAt: null }).where(eq(accounts.id, id)).returning();
        await record({ companyId, userId, entity: 'account', entityId: id, action: 'unarchive' });
        return out!;
      });
    },

    async reorder(companyId, ids, userId) {
      await requireCompany(db, companyId, { writable: true });
      const current = (await svc.list(companyId)).map((a) => a.id);
      assertSameSet(current, ids);
      if (!isSameOrder(current, ids)) {
        await mutateAsync(db, audit, async (tx, record) => {
          for (const [i, accountId] of ids.entries()) await tx.update(accounts).set({ orderIndex: i }).where(eq(accounts.id, accountId));
          await record({ companyId, userId, entity: 'account', action: 'reorder', diff: { ids } });
        });
      }
      return svc.list(companyId);
    },

    async remove(companyId, id, userId) {
      await requireCompany(db, companyId, { writable: true });
      const row = await requireAccount(companyId, id);
      if ((await references.countOperations('account', id)) > 0) {
        throw new AppError(422, 'INVARIANT_9', 'На счёт ссылаются операции — его можно только перевести в архив');
      }
      await mutateAsync(db, audit, async (tx, record) => {
        await tx.delete(accounts).where(eq(accounts.id, id));
        await record({ companyId, userId, entity: 'account', entityId: id, action: 'delete', diff: { name: row.name, currency: row.currency } });
      });
    },
  };
  return svc;
}
