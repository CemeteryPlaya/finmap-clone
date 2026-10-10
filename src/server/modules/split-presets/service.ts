import { and, asc, eq, inArray, sql } from 'drizzle-orm';
import { cleanName } from '../../../shared/text';
import type { Db } from '../../db/client';
import { categories, projects, splitPresets } from '../../db/schema';
import { AppError } from '../../errors';
import { changedFields, mutate } from '../audit/mutate';
import type { AuditService } from '../audit/service';
import { requireCompany } from '../companies/guard';
import { assertSameSet, isSameOrder } from '../dictionaries/order';

export interface SplitLine {
  categoryId: number | null;
  projectId: number | null;
  bp: number;
}

export interface SplitPresetRow {
  id: number;
  companyId: number;
  name: string;
  lines: SplitLine[];
  orderIndex: number;
  createdAt: string;
  archivedAt: string | null;
}

export interface SplitPresetsService {
  list(companyId: number): SplitPresetRow[];
  add(companyId: number, input: { name: string; lines: SplitLine[] }, userId: number): SplitPresetRow;
  update(companyId: number, id: number, input: { name?: string; lines?: SplitLine[] }, userId: number): SplitPresetRow;
  archive(companyId: number, id: number, userId: number): SplitPresetRow;
  unarchive(companyId: number, id: number, userId: number): SplitPresetRow;
  reorder(companyId: number, ids: number[], userId: number): SplitPresetRow[];
  remove(companyId: number, id: number, userId: number): void;
}

const ENTITY = 'split_preset';

function toRow(r: typeof splitPresets.$inferSelect): SplitPresetRow {
  return { ...r, lines: JSON.parse(r.lines) as SplitLine[] };
}

const invalidLines = (message: string) => new AppError(400, 'VALIDATION', 'Проверьте заполнение полей', { lines: message });

export function createSplitPresetsService(d: { db: Db; audit: AuditService; now?: () => Date }): SplitPresetsService {
  const { db, audit } = d;
  const now = d.now ?? (() => new Date());

  function requireRow(companyId: number, id: number): SplitPresetRow {
    const row = db.select().from(splitPresets).where(and(eq(splitPresets.id, id), eq(splitPresets.companyId, companyId))).get();
    if (!row) throw new AppError(404, 'NOT_FOUND', 'Шаблон разделения не найден');
    return toRow(row);
  }

  /** Категории и проекты строк: той же компании (инвариант 5), не в архиве (инвариант 7), категории одного вида. */
  function checkRefs(companyId: number, lines: SplitLine[]): void {
    const catIds = [...new Set(lines.flatMap((l) => (l.categoryId === null ? [] : [l.categoryId])))];
    const projIds = [...new Set(lines.flatMap((l) => (l.projectId === null ? [] : [l.projectId])))];
    const cats = catIds.length
      ? db.select().from(categories).where(and(eq(categories.companyId, companyId), inArray(categories.id, catIds))).all()
      : [];
    const projs = projIds.length
      ? db.select().from(projects).where(and(eq(projects.companyId, companyId), inArray(projects.id, projIds))).all()
      : [];
    if (cats.length !== catIds.length) throw invalidLines('Категория не найдена в этой компании');
    if (projs.length !== projIds.length) throw invalidLines('Проект не найден в этой компании');
    if (new Set(cats.map((c) => c.kind)).size > 1) throw invalidLines('Категории шаблона должны быть одного вида');
    const archived = [...cats, ...projs].find((x) => x.archivedAt);
    if (archived) throw new AppError(422, 'ARCHIVED_REFERENCE', `«${archived.name}» в архиве — выберите другой элемент`);
  }

  function setArchived(companyId: number, id: number, userId: number, archive: boolean): SplitPresetRow {
    requireCompany(db, companyId, { writable: true });
    const row = requireRow(companyId, id);
    if ((row.archivedAt !== null) === archive) return row;
    return mutate(db, audit, (tx, record) => {
      const out = tx
        .update(splitPresets)
        .set({ archivedAt: archive ? now().toISOString() : null })
        .where(eq(splitPresets.id, id))
        .returning()
        .get();
      record({ companyId, userId, entity: ENTITY, entityId: id, action: archive ? 'archive' : 'unarchive' });
      return toRow(out);
    });
  }

  const svc: SplitPresetsService = {
    list(companyId) {
      requireCompany(db, companyId);
      return db
        .select()
        .from(splitPresets)
        .where(eq(splitPresets.companyId, companyId))
        .orderBy(asc(splitPresets.orderIndex), asc(splitPresets.id))
        .all()
        .map(toRow);
    },

    add(companyId, input, userId) {
      requireCompany(db, companyId, { writable: true });
      checkRefs(companyId, input.lines);
      return mutate(db, audit, (tx, record) => {
        const next = tx
          .select({ m: sql<number>`coalesce(max(${splitPresets.orderIndex}), -1)` })
          .from(splitPresets)
          .where(eq(splitPresets.companyId, companyId))
          .get();
        const row = toRow(
          tx
            .insert(splitPresets)
            .values({
              companyId,
              name: cleanName(input.name),
              lines: JSON.stringify(input.lines),
              orderIndex: (next?.m ?? -1) + 1,
              createdAt: now().toISOString(),
            })
            .returning()
            .get(),
        );
        record({ companyId, userId, entity: ENTITY, entityId: row.id, action: 'create', diff: { name: row.name, lines: row.lines } });
        return row;
      });
    },

    update(companyId, id, input, userId) {
      requireCompany(db, companyId, { writable: true });
      const before = requireRow(companyId, id);
      if (before.archivedAt) throw new AppError(422, 'ARCHIVED_REFERENCE', 'Шаблон в архиве — сначала верните его из архива');
      const patch = { ...input, ...(input.name !== undefined ? { name: cleanName(input.name) } : {}) };
      const changes = changedFields({ name: before.name, lines: before.lines }, patch);
      if (!changes) return before;
      const { name, lines } = changes.after;
      if (lines !== undefined) checkRefs(companyId, lines); // старые строки не перепроверяем (инвариант 10)
      return mutate(db, audit, (tx, record) => {
        const row = tx
          .update(splitPresets)
          .set({ ...(name !== undefined ? { name } : {}), ...(lines !== undefined ? { lines: JSON.stringify(lines) } : {}) })
          .where(eq(splitPresets.id, id))
          .returning()
          .get();
        record({ companyId, userId, entity: ENTITY, entityId: id, action: 'update', diff: changes });
        return toRow(row);
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
          ids.forEach((rowId, i) => tx.update(splitPresets).set({ orderIndex: i }).where(eq(splitPresets.id, rowId)).run());
          record({ companyId, userId, entity: ENTITY, action: 'reorder', diff: { ids } });
        });
      }
      return svc.list(companyId);
    },

    remove(companyId, id, userId) {
      requireCompany(db, companyId, { writable: true });
      const row = requireRow(companyId, id);
      // на шаблоны разделения операции не ссылаются — удаление всегда возможно
      mutate(db, audit, (tx, record) => {
        tx.delete(splitPresets).where(eq(splitPresets.id, id)).run();
        record({ companyId, userId, entity: ENTITY, entityId: id, action: 'delete', diff: { name: row.name } });
      });
    },
  };
  return svc;
}
