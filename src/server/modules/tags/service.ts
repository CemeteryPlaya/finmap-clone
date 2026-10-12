import { and, asc, eq, sql } from 'drizzle-orm';
import { foldCase } from '../../../shared/search';
import { cleanName } from '../../../shared/text';
import type { Db, Executor } from '../../db/client';
import { tags } from '../../db/schema';
import { AppError } from '../../errors';
import { changedFields, mutate } from '../audit/mutate';
import type { AuditService } from '../audit/service';
import { requireCompany } from '../companies/guard';
import { assertSameSet, isSameOrder } from '../dictionaries/order';
import { createReferencesService, type ReferencesService } from '../references/service';

export type TagRow = typeof tags.$inferSelect;

export interface TagsService {
  list(companyId: number): TagRow[];
  /**
   * Низкоуровневое создание внутри чужой транзакции (импорт, §6.4 спецификации импорта): без истории — её пишет вызывающий.
   * Свободу имени проверяет вызывающий (импорт сопоставляет теги по ключу, включая архивные); повтор ключа отклонит уникальный индекс.
   */
  createIn(ex: Executor, input: { companyId: number; name: string }): TagRow;
  add(companyId: number, name: string, userId: number): TagRow;
  rename(companyId: number, id: number, name: string, userId: number): TagRow;
  archive(companyId: number, id: number, userId: number): TagRow;
  unarchive(companyId: number, id: number, userId: number): TagRow;
  reorder(companyId: number, ids: number[], userId: number): TagRow[];
  remove(companyId: number, id: number, userId: number): void;
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

  function requireRow(companyId: number, id: number): TagRow {
    const row = db.select().from(tags).where(and(eq(tags.id, id), eq(tags.companyId, companyId))).get();
    if (!row) throw new AppError(404, 'NOT_FOUND', 'Тег не найден');
    return row;
  }

  /** Имя свободно в компании, включая архивные теги; архивный дубль — предложение вернуть его. */
  function assertNameFree(companyId: number, name: string, exceptId?: number): void {
    const clash = db.select().from(tags).where(and(eq(tags.companyId, companyId), eq(tags.nameKey, tagKey(name)))).get();
    if (!clash || clash.id === exceptId) return;
    if (clash.archivedAt) {
      throw new AppError(422, 'ARCHIVED_DUPLICATE', `Тег «${clash.name}» есть в архиве — верните его из архива`, {
        name: 'Такой тег есть в архиве',
      });
    }
    throw new AppError(400, 'VALIDATION', 'Проверьте заполнение полей', { name: 'Такой тег уже есть' });
  }

  function setArchived(companyId: number, id: number, userId: number, archive: boolean): TagRow {
    requireCompany(db, companyId, { writable: true });
    const row = requireRow(companyId, id);
    if ((row.archivedAt !== null) === archive) return row;
    return mutate(db, audit, (tx, record) => {
      const out = tx.update(tags).set({ archivedAt: archive ? now().toISOString() : null }).where(eq(tags.id, id)).returning().get();
      record({ companyId, userId, entity: ENTITY, entityId: id, action: archive ? 'archive' : 'unarchive' });
      return out;
    });
  }

  const svc: TagsService = {
    list(companyId) {
      requireCompany(db, companyId);
      return db.select().from(tags).where(eq(tags.companyId, companyId)).orderBy(asc(tags.orderIndex), asc(tags.id)).all();
    },

    createIn(ex, input) {
      const name = cleanName(input.name);
      const next = ex
        .select({ m: sql<number>`coalesce(max(${tags.orderIndex}), -1)` })
        .from(tags)
        .where(eq(tags.companyId, input.companyId))
        .get();
      return ex
        .insert(tags)
        .values({ companyId: input.companyId, name, nameKey: tagKey(name), orderIndex: (next?.m ?? -1) + 1, createdAt: now().toISOString() })
        .returning()
        .get();
    },

    add(companyId, rawName, userId) {
      requireCompany(db, companyId, { writable: true });
      const name = cleanName(rawName);
      assertNameFree(companyId, name);
      return mutate(db, audit, (tx, record) => {
        const row = svc.createIn(tx, { companyId, name });
        record({ companyId, userId, entity: ENTITY, entityId: row.id, action: 'create', diff: { name } });
        return row;
      });
    },

    rename(companyId, id, rawName, userId) {
      requireCompany(db, companyId, { writable: true });
      const before = requireRow(companyId, id);
      if (before.archivedAt) throw new AppError(422, 'ARCHIVED_REFERENCE', 'Тег в архиве — сначала верните его из архива');
      const changes = changedFields({ name: before.name }, { name: cleanName(rawName) });
      if (!changes) return before;
      const name = changes.after.name!;
      assertNameFree(companyId, name, id);
      return mutate(db, audit, (tx, record) => {
        const row = tx.update(tags).set({ name, nameKey: tagKey(name) }).where(eq(tags.id, id)).returning().get();
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
          ids.forEach((rowId, i) => tx.update(tags).set({ orderIndex: i }).where(eq(tags.id, rowId)).run());
          record({ companyId, userId, entity: ENTITY, action: 'reorder', diff: { ids } });
        });
      }
      return svc.list(companyId);
    },

    remove(companyId, id, userId) {
      requireCompany(db, companyId, { writable: true });
      const row = requireRow(companyId, id);
      if (references.countOperations('tag', id) > 0) {
        throw new AppError(422, 'INVARIANT_9', 'Тег стоит на операциях — его можно только перевести в архив');
      }
      mutate(db, audit, (tx, record) => {
        tx.delete(tags).where(eq(tags.id, id)).run();
        record({ companyId, userId, entity: ENTITY, entityId: id, action: 'delete', diff: { name: row.name } });
      });
    },
  };
  return svc;
}
