import { and, asc, eq, sql } from 'drizzle-orm';
import type { CounterpartyType } from '../../../shared/system-categories';
import { cleanName } from '../../../shared/text';
import type { Db, Executor } from '../../db/client';
import { first } from '../../db/raw';
import { counterparties } from '../../db/schema';
import { AppError } from '../../errors';
import { changedFields, mutateAsync } from '../audit/mutate';
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
  list(companyId: number): Promise<CounterpartyRow[]>;
  /** Низкоуровневое создание внутри чужой транзакции (импорт, §6.4 спецификации импорта): без истории — её пишет вызывающий. */
  createIn(ex: Executor, input: { companyId: number; type: CounterpartyType; name: string }): Promise<CounterpartyRow>;
  add(companyId: number, input: CounterpartyInput, userId: number): Promise<CounterpartyRow>;
  update(companyId: number, id: number, input: Partial<CounterpartyInput>, userId: number): Promise<CounterpartyRow>;
  archive(companyId: number, id: number, userId: number): Promise<CounterpartyRow>;
  unarchive(companyId: number, id: number, userId: number): Promise<CounterpartyRow>;
  reorder(companyId: number, ids: number[], userId: number): Promise<CounterpartyRow[]>;
  remove(companyId: number, id: number, userId: number): Promise<void>;
}

const ENTITY = 'counterparty';

export function createCounterpartiesService(d: { db: Db; audit: AuditService; references?: ReferencesService; now?: () => Date }): CounterpartiesService {
  const { db, audit } = d;
  const now = d.now ?? (() => new Date());
  const references = d.references ?? createReferencesService();

  async function requireRow(companyId: number, id: number): Promise<CounterpartyRow> {
    const row = await first(db.select().from(counterparties).where(and(eq(counterparties.id, id), eq(counterparties.companyId, companyId))));
    if (!row) throw new AppError(404, 'NOT_FOUND', 'Контрагент не найден');
    return row;
  }

  async function setArchived(companyId: number, id: number, userId: number, archive: boolean): Promise<CounterpartyRow> {
    await requireCompany(db, companyId, { writable: true });
    const row = await requireRow(companyId, id);
    if ((row.archivedAt !== null) === archive) return row;
    return mutateAsync(db, audit, async (tx, record) => {
      const [out] = await tx
        .update(counterparties)
        .set({ archivedAt: archive ? now().toISOString() : null })
        .where(eq(counterparties.id, id))
        .returning();
      await record({ companyId, userId, entity: ENTITY, entityId: id, action: archive ? 'archive' : 'unarchive' });
      return out!;
    });
  }

  /** Новый контрагент в конце списка компании. */
  async function insert(ex: Executor, v: { companyId: number; type: CounterpartyType; name: string; comment: string | null }): Promise<CounterpartyRow> {
    const next = await first(
      ex
        .select({ m: sql<number>`coalesce(max(${counterparties.orderIndex}), -1)` })
        .from(counterparties)
        .where(eq(counterparties.companyId, v.companyId)),
    );
    const [row] = await ex
      .insert(counterparties)
      .values({ companyId: v.companyId, type: v.type, name: cleanName(v.name), comment: v.comment, orderIndex: Number(next?.m ?? -1) + 1, createdAt: now().toISOString() })
      .returning();
    return row!;
  }

  const svc: CounterpartiesService = {
    async list(companyId) {
      await requireCompany(db, companyId);
      return db
        .select()
        .from(counterparties)
        .where(eq(counterparties.companyId, companyId))
        .orderBy(asc(counterparties.orderIndex), asc(counterparties.id));
    },

    createIn(ex, input) {
      return insert(ex, { ...input, comment: null });
    },

    async add(companyId, input, userId) {
      await requireCompany(db, companyId, { writable: true });
      return mutateAsync(db, audit, async (tx, record) => {
        const row = await insert(tx, { companyId, type: input.type, name: input.name, comment: input.comment ?? null });
        await record({ companyId, userId, entity: ENTITY, entityId: row.id, action: 'create', diff: { type: row.type, name: row.name, comment: row.comment } });
        return row;
      });
    },

    async update(companyId, id, input, userId) {
      await requireCompany(db, companyId, { writable: true });
      const before = await requireRow(companyId, id);
      if (before.archivedAt) throw new AppError(422, 'ARCHIVED_REFERENCE', 'Контрагент в архиве — сначала верните его из архива');
      const patch = { ...input, ...(input.name !== undefined ? { name: cleanName(input.name) } : {}) };
      const changes = changedFields({ type: before.type, name: before.name, comment: before.comment }, patch);
      if (!changes) return before;
      return mutateAsync(db, audit, async (tx, record) => {
        const [row] = await tx.update(counterparties).set(changes.after).where(eq(counterparties.id, id)).returning();
        await record({ companyId, userId, entity: ENTITY, entityId: id, action: 'update', diff: changes });
        return row!;
      });
    },

    archive: (companyId, id, userId) => setArchived(companyId, id, userId, true),
    unarchive: (companyId, id, userId) => setArchived(companyId, id, userId, false),

    async reorder(companyId, ids, userId) {
      await requireCompany(db, companyId, { writable: true });
      const current = (await svc.list(companyId)).map((r) => r.id);
      assertSameSet(current, ids);
      if (!isSameOrder(current, ids)) {
        await mutateAsync(db, audit, async (tx, record) => {
          for (const [i, rowId] of ids.entries()) await tx.update(counterparties).set({ orderIndex: i }).where(eq(counterparties.id, rowId));
          await record({ companyId, userId, entity: ENTITY, action: 'reorder', diff: { ids } });
        });
      }
      return svc.list(companyId);
    },

    async remove(companyId, id, userId) {
      await requireCompany(db, companyId, { writable: true });
      const row = await requireRow(companyId, id);
      if ((await references.countOperations('counterparty', id)) > 0) {
        throw new AppError(422, 'INVARIANT_9', 'На контрагента ссылаются операции — его можно только перевести в архив');
      }
      await mutateAsync(db, audit, async (tx, record) => {
        await tx.delete(counterparties).where(eq(counterparties.id, id));
        await record({ companyId, userId, entity: ENTITY, entityId: id, action: 'delete', diff: { type: row.type, name: row.name } });
      });
    },
  };
  return svc;
}
