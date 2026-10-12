import { and, asc, eq, sql } from 'drizzle-orm';
import type { CounterpartyType } from '../../../shared/system-categories';
import { cleanName } from '../../../shared/text';
import type { Db, Executor } from '../../db/client';
import { counterparties } from '../../db/schema';
import { AppError } from '../../errors';
import { changedFields, mutate } from '../audit/mutate';
import type { AuditService } from '../audit/service';
import { requireCompany } from '../companies/guard';
import { assertSameSet, isSameOrder } from '../dictionaries/order';
import { createReferencesService, type ReferencesService } from '../references/service';

export type CounterpartyRow = typeof counterparties.$inferSelect;

export interface CounterpartyInput {
  type: CounterpartyType;
  name: string;
  comment?: string | null;
}

export interface CounterpartiesService {
  list(companyId: number): CounterpartyRow[];
  /** Низкоуровневое создание внутри чужой транзакции (импорт, §6.4 спецификации импорта): без истории — её пишет вызывающий. */
  createIn(ex: Executor, input: { companyId: number; type: CounterpartyType; name: string }): CounterpartyRow;
  add(companyId: number, input: CounterpartyInput, userId: number): CounterpartyRow;
  update(companyId: number, id: number, input: Partial<CounterpartyInput>, userId: number): CounterpartyRow;
  archive(companyId: number, id: number, userId: number): CounterpartyRow;
  unarchive(companyId: number, id: number, userId: number): CounterpartyRow;
  reorder(companyId: number, ids: number[], userId: number): CounterpartyRow[];
  remove(companyId: number, id: number, userId: number): void;
}

const ENTITY = 'counterparty';

export function createCounterpartiesService(d: { db: Db; audit: AuditService; references?: ReferencesService; now?: () => Date }): CounterpartiesService {
  const { db, audit } = d;
  const now = d.now ?? (() => new Date());
  const references = d.references ?? createReferencesService();

  function requireRow(companyId: number, id: number): CounterpartyRow {
    const row = db.select().from(counterparties).where(and(eq(counterparties.id, id), eq(counterparties.companyId, companyId))).get();
    if (!row) throw new AppError(404, 'NOT_FOUND', 'Контрагент не найден');
    return row;
  }

  function setArchived(companyId: number, id: number, userId: number, archive: boolean): CounterpartyRow {
    requireCompany(db, companyId, { writable: true });
    const row = requireRow(companyId, id);
    if ((row.archivedAt !== null) === archive) return row;
    return mutate(db, audit, (tx, record) => {
      const out = tx
        .update(counterparties)
        .set({ archivedAt: archive ? now().toISOString() : null })
        .where(eq(counterparties.id, id))
        .returning()
        .get();
      record({ companyId, userId, entity: ENTITY, entityId: id, action: archive ? 'archive' : 'unarchive' });
      return out;
    });
  }

  /** Новый контрагент в конце списка компании. */
  function insert(ex: Executor, v: { companyId: number; type: CounterpartyType; name: string; comment: string | null }): CounterpartyRow {
    const next = ex
      .select({ m: sql<number>`coalesce(max(${counterparties.orderIndex}), -1)` })
      .from(counterparties)
      .where(eq(counterparties.companyId, v.companyId))
      .get();
    return ex
      .insert(counterparties)
      .values({ companyId: v.companyId, type: v.type, name: cleanName(v.name), comment: v.comment, orderIndex: (next?.m ?? -1) + 1, createdAt: now().toISOString() })
      .returning()
      .get();
  }

  const svc: CounterpartiesService = {
    list(companyId) {
      requireCompany(db, companyId);
      return db
        .select()
        .from(counterparties)
        .where(eq(counterparties.companyId, companyId))
        .orderBy(asc(counterparties.orderIndex), asc(counterparties.id))
        .all();
    },

    createIn(ex, input) {
      return insert(ex, { ...input, comment: null });
    },

    add(companyId, input, userId) {
      requireCompany(db, companyId, { writable: true });
      return mutate(db, audit, (tx, record) => {
        const row = insert(tx, { companyId, type: input.type, name: input.name, comment: input.comment ?? null });
        record({ companyId, userId, entity: ENTITY, entityId: row.id, action: 'create', diff: { type: row.type, name: row.name, comment: row.comment } });
        return row;
      });
    },

    update(companyId, id, input, userId) {
      requireCompany(db, companyId, { writable: true });
      const before = requireRow(companyId, id);
      if (before.archivedAt) throw new AppError(422, 'ARCHIVED_REFERENCE', 'Контрагент в архиве — сначала верните его из архива');
      const patch = { ...input, ...(input.name !== undefined ? { name: cleanName(input.name) } : {}) };
      const changes = changedFields({ type: before.type, name: before.name, comment: before.comment }, patch);
      if (!changes) return before;
      return mutate(db, audit, (tx, record) => {
        const row = tx.update(counterparties).set(changes.after).where(eq(counterparties.id, id)).returning().get();
        record({ companyId, userId, entity: ENTITY, entityId: id, action: 'update', diff: changes });
        return row;
      });
    },

    archive: (companyId, id, userId) => setArchived(companyId, id, userId, true),
    unarchive: (companyId, id, userId) => setArchived(companyId, id, userId, false),

    reorder(companyId, ids, userId) {
      requireCompany(db, companyId, { writable: true });
      const current = svc.list(companyId).map((r) => r.id);
      assertSameSet(current, ids);
      if (!isSameOrder(current, ids)) {
        mutate(db, audit, (tx, record) => {
          ids.forEach((rowId, i) => tx.update(counterparties).set({ orderIndex: i }).where(eq(counterparties.id, rowId)).run());
          record({ companyId, userId, entity: ENTITY, action: 'reorder', diff: { ids } });
        });
      }
      return svc.list(companyId);
    },

    remove(companyId, id, userId) {
      requireCompany(db, companyId, { writable: true });
      const row = requireRow(companyId, id);
      if (references.countOperations('counterparty', id) > 0) {
        throw new AppError(422, 'INVARIANT_9', 'На контрагента ссылаются операции — его можно только перевести в архив');
      }
      mutate(db, audit, (tx, record) => {
        tx.delete(counterparties).where(eq(counterparties.id, id)).run();
        record({ companyId, userId, entity: ENTITY, entityId: id, action: 'delete', diff: { type: row.type, name: row.name } });
      });
    },
  };
  return svc;
}
