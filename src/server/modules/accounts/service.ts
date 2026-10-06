import { and, asc, count, eq, isNull, sql } from 'drizzle-orm';
import { isKnownCurrency } from '../../../shared/currencies';
import { formatDateRu, isValidDate, todayInTimezone } from '../../../shared/dates';
import { ACCOUNT_NAME_MAX } from '../../../shared/schemas/accounts';
import { cleanName } from '../../../shared/text';
import type { Db, Executor } from '../../db/client';
import { accounts, projects } from '../../db/schema';
import { AppError } from '../../errors';
import { changedFields, mutate } from '../audit/mutate';
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
  ): AccountRow;
  list(companyId: number): AccountRow[];
  countActive(companyId: number, projectId?: number): number;
  /** Все счета проекта, включая архивные (удаление проекта). */
  countByProject(companyId: number, projectId: number): number;
  add(companyId: number, input: AccountInput, userId: number): AccountRow;
  update(companyId: number, id: number, input: AccountPatch, userId: number): AccountRow;
  archive(companyId: number, id: number, userId: number): AccountRow;
  unarchive(companyId: number, id: number, userId: number): AccountRow;
  reorder(companyId: number, ids: number[], userId: number): AccountRow[];
  remove(companyId: number, id: number, userId: number): void;
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
  function validate(ex: Executor, companyId: number, v: AccountPatch): void {
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
      const p = ex
        .select({ companyId: projects.companyId, archivedAt: projects.archivedAt })
        .from(projects)
        .where(eq(projects.id, v.projectId))
        .get();
      if (!p || p.companyId !== companyId) fields.projectId = 'Проект не найден в этой компании';
      else if (p.archivedAt) archivedProject = true;
    }
    if (Object.keys(fields).length) throw new AppError(400, 'VALIDATION', 'Проверьте заполнение полей', fields);
    if (archivedProject) throw new AppError(422, 'ARCHIVED_REFERENCE', 'Проект в архиве — выберите другой');
  }

  function requireAccount(companyId: number, id: number): AccountRow {
    const row = db.select().from(accounts).where(and(eq(accounts.id, id), eq(accounts.companyId, companyId))).get();
    if (!row) throw new AppError(404, 'NOT_FOUND', 'Счёт не найден');
    return row;
  }

  const svc: AccountsService = {
    create(ex, input) {
      const name = cleanName(input.name);
      const startingBalance = input.startingBalance ?? 0;
      validate(ex, input.companyId, { name, currency: input.currency, startingBalance, openedAt: input.openedAt, projectId: input.projectId ?? null });
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

    countByProject(companyId, projectId) {
      return (
        db
          .select({ n: count() })
          .from(accounts)
          .where(and(eq(accounts.companyId, companyId), eq(accounts.projectId, projectId)))
          .get()?.n ?? 0
      );
    },

    add(companyId, input, userId) {
      requireCompany(db, companyId, { writable: true });
      return mutate(db, audit, (tx, record) => {
        const row = svc.create(tx, {
          companyId,
          name: input.name,
          currency: input.currency,
          startingBalance: input.startingBalance,
          openedAt: input.openedAt ?? todayInTimezone(d.timezone, now()),
          projectId: input.projectId ?? null,
        });
        record({
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

    update(companyId, id, input, userId) {
      requireCompany(db, companyId, { writable: true });
      const before = requireAccount(companyId, id);
      if (before.archivedAt) throw new AppError(422, 'ARCHIVED_REFERENCE', 'Счёт в архиве — сначала верните его из архива');
      const patch: AccountPatch = { ...input, ...(input.name !== undefined ? { name: cleanName(input.name) } : {}) };
      const changes = changedFields(
        { name: before.name, currency: before.currency, startingBalance: before.startingBalance, openedAt: before.openedAt, projectId: before.projectId },
        patch,
      );
      if (!changes) return before;
      const after = changes.after;
      validate(db, companyId, after);
      if (after.currency !== undefined && references.countOperations('account', id) > 0) {
        throw new AppError(422, 'CURRENCY_LOCKED', 'По счёту есть операции — валюту изменить нельзя');
      }
      if (after.openedAt !== undefined) {
        const earliest = references.earliestOperationDate(id);
        if (earliest !== null && after.openedAt > earliest) {
          throw new AppError(422, 'INVARIANT_6', `Есть операции от ${formatDateRu(earliest)} — дата открытия не может быть позже`);
        }
      }
      return mutate(db, audit, (tx, record) => {
        const row = tx.update(accounts).set(after).where(eq(accounts.id, id)).returning().get();
        record({ companyId, userId, entity: 'account', entityId: id, action: 'update', diff: changes });
        return row;
      });
    },

    archive(companyId, id, userId) {
      requireCompany(db, companyId, { writable: true });
      const row = requireAccount(companyId, id);
      if (row.archivedAt) return row;
      if (balances.accountBalance(row) !== 0) {
        throw new AppError(422, 'ARCHIVED_REFERENCE', 'Счёт можно перевести в архив только при нулевом балансе');
      }
      return mutate(db, audit, (tx, record) => {
        const out = tx.update(accounts).set({ archivedAt: now().toISOString() }).where(eq(accounts.id, id)).returning().get();
        record({ companyId, userId, entity: 'account', entityId: id, action: 'archive' });
        return out;
      });
    },

    unarchive(companyId, id, userId) {
      requireCompany(db, companyId, { writable: true });
      const row = requireAccount(companyId, id);
      if (!row.archivedAt) return row;
      if (row.projectId !== null) {
        const p = db.select({ archivedAt: projects.archivedAt }).from(projects).where(eq(projects.id, row.projectId)).get();
        if (p?.archivedAt) throw new AppError(422, 'ARCHIVED_REFERENCE', 'Проект счёта в архиве — сначала верните проект');
      }
      return mutate(db, audit, (tx, record) => {
        const out = tx.update(accounts).set({ archivedAt: null }).where(eq(accounts.id, id)).returning().get();
        record({ companyId, userId, entity: 'account', entityId: id, action: 'unarchive' });
        return out;
      });
    },

    reorder(companyId, ids, userId) {
      requireCompany(db, companyId, { writable: true });
      const current = svc.list(companyId).map((a) => a.id);
      assertSameSet(current, ids);
      if (!isSameOrder(current, ids)) {
        mutate(db, audit, (tx, record) => {
          ids.forEach((accountId, i) => tx.update(accounts).set({ orderIndex: i }).where(eq(accounts.id, accountId)).run());
          record({ companyId, userId, entity: 'account', action: 'reorder', diff: { ids } });
        });
      }
      return svc.list(companyId);
    },

    remove(companyId, id, userId) {
      requireCompany(db, companyId, { writable: true });
      const row = requireAccount(companyId, id);
      if (references.countOperations('account', id) > 0) {
        throw new AppError(422, 'INVARIANT_9', 'На счёт ссылаются операции — его можно только перевести в архив');
      }
      mutate(db, audit, (tx, record) => {
        tx.delete(accounts).where(eq(accounts.id, id)).run();
        record({ companyId, userId, entity: 'account', entityId: id, action: 'delete', diff: { name: row.name, currency: row.currency } });
      });
    },
  };
  return svc;
}
