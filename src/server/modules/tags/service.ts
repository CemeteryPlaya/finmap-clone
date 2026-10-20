import { and, asc, eq, sql } from 'drizzle-orm';
import { foldCase } from '../../../shared/search';
import { cleanName } from '../../../shared/text';
import type { Db, Executor } from '../../db/client';
import { first } from '../../db/raw';
import { tags } from '../../db/schema';
import { AppError } from '../../errors';
import { changedFields, mutateAsync } from '../audit/mutate';
import type { AuditService } from '../audit/service';
import { requireCompany } from '../companies/guard';
import { assertSameSet, isSameOrder } from '../dictionaries/order';
import { createReferencesService, type ReferencesService } from '../references/service';

export type TagRow = typeof tags.$inferSelect;

export interface TagsService {
  list(companyId: number): Promise<TagRow[]>;
  /**
   * Низкоуровневое создание внутри чужой транзакции (импорт, §6.4 спецификации импорта): без истории — её пишет вызывающий.
   * Свободу имени проверяет вызывающий (импорт сопоставляет теги по ключу, включая архивные); повтор ключа отклонит уникальный индекс.
   */
  createIn(ex: Executor, input: { companyId: number; name: string }): Promise<TagRow>;
  add(companyId: number, name: string, userId: number): Promise<TagRow>;
  rename(companyId: number, id: number, name: string, userId: number): Promise<TagRow>;
  archive(companyId: number, id: number, userId: number): Promise<TagRow>;
  unarchive(companyId: number, id: number, userId: number): Promise<TagRow>;
  reorder(companyId: number, ids: number[], userId: number): Promise<TagRow[]>;
  remove(companyId: number, id: number, userId: number): Promise<void>;
}

const ENTITY = 'tag';

/** Ключ уникальности тега: без учёта регистра, «ё» и невидимых символов. */
export function tagKey(name: string): string {
  return foldCase(cleanName(name));
}

export function createTagsService(d: { db: Db; audit: AuditService; references?: ReferencesService; now?: () => Date }): TagsService {
  const { db, audit } = d;
  const now = d.now ?? (() => new Date());
  const references = d.references ?? createReferencesService();

  async function requireRow(companyId: number, id: number): Promise<TagRow> {
    const row = await first(db.select().from(tags).where(and(eq(tags.id, id), eq(tags.companyId, companyId))));
    if (!row) throw new AppError(404, 'NOT_FOUND', 'Тег не найден');
    return row;
  }

  /** Имя свободно в компании, включая архивные теги; архивный дубль — предложение вернуть его. */
  async function assertNameFree(companyId: number, name: string, exceptId?: number): Promise<void> {
    const clash = await first(db.select().from(tags).where(and(eq(tags.companyId, companyId), eq(tags.nameKey, tagKey(name)))));
    if (!clash || clash.id === exceptId) return;
    if (clash.archivedAt) {
      throw new AppError(422, 'ARCHIVED_DUPLICATE', `Тег «${clash.name}» есть в архиве — верните его из архива`, {
        name: 'Такой тег есть в архиве',
      });
    }
    throw new AppError(400, 'VALIDATION', 'Проверьте заполнение полей', { name: 'Такой тег уже есть' });
  }

  async function setArchived(companyId: number, id: number, userId: number, archive: boolean): Promise<TagRow> {
    await requireCompany(db, companyId, { writable: true });
    const row = await requireRow(companyId, id);
    if ((row.archivedAt !== null) === archive) return row;
    return mutateAsync(db, audit, async (tx, record) => {
      const [out] = await tx.update(tags).set({ archivedAt: archive ? now().toISOString() : null }).where(eq(tags.id, id)).returning();
      await record({ companyId, userId, entity: ENTITY, entityId: id, action: archive ? 'archive' : 'unarchive' });
      return out!;
    });
  }

  const svc: TagsService = {
    async list(companyId) {
      await requireCompany(db, companyId);
      return db.select().from(tags).where(eq(tags.companyId, companyId)).orderBy(asc(tags.orderIndex), asc(tags.id));
    },

    async createIn(ex, input) {
      const name = cleanName(input.name);
      const next = await first(
        ex
          .select({ m: sql<number>`coalesce(max(${tags.orderIndex}), -1)` })
          .from(tags)
          .where(eq(tags.companyId, input.companyId)),
      );
      const [row] = await ex
        .insert(tags)
        .values({ companyId: input.companyId, name, nameKey: tagKey(name), orderIndex: Number(next?.m ?? -1) + 1, createdAt: now().toISOString() })
        .returning();
      return row!;
    },

    async add(companyId, rawName, userId) {
      await requireCompany(db, companyId, { writable: true });
      const name = cleanName(rawName);
      await assertNameFree(companyId, name);
      return mutateAsync(db, audit, async (tx, record) => {
        const row = await svc.createIn(tx, { companyId, name });
        await record({ companyId, userId, entity: ENTITY, entityId: row.id, action: 'create', diff: { name } });
        return row;
      });
    },

    async rename(companyId, id, rawName, userId) {
      await requireCompany(db, companyId, { writable: true });
      const before = await requireRow(companyId, id);
      if (before.archivedAt) throw new AppError(422, 'ARCHIVED_REFERENCE', 'Тег в архиве — сначала верните его из архива');
      const changes = changedFields({ name: before.name }, { name: cleanName(rawName) });
      if (!changes) return before;
      const name = changes.after.name!;
      await assertNameFree(companyId, name, id);
      return mutateAsync(db, audit, async (tx, record) => {
        const [row] = await tx.update(tags).set({ name, nameKey: tagKey(name) }).where(eq(tags.id, id)).returning();
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
          for (const [i, rowId] of ids.entries()) await tx.update(tags).set({ orderIndex: i }).where(eq(tags.id, rowId));
          await record({ companyId, userId, entity: ENTITY, action: 'reorder', diff: { ids } });
        });
      }
      return svc.list(companyId);
    },

    async remove(companyId, id, userId) {
      await requireCompany(db, companyId, { writable: true });
      const row = await requireRow(companyId, id);
      if ((await references.countOperations('tag', id)) > 0) {
        throw new AppError(422, 'INVARIANT_9', 'Тег стоит на операциях — его можно только перевести в архив');
      }
      await mutateAsync(db, audit, async (tx, record) => {
        await tx.delete(tags).where(eq(tags.id, id));
        await record({ companyId, userId, entity: ENTITY, entityId: id, action: 'delete', diff: { name: row.name } });
      });
    },
  };
  return svc;
}
