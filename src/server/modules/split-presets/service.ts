import { and, asc, eq, inArray, sql } from 'drizzle-orm';
import { cleanName } from '../../../shared/text';
import type { Db } from '../../db/client';
import { first } from '../../db/raw';
import { categories, projects, splitPresets } from '../../db/schema';
import { AppError } from '../../errors';
import { changedFields, mutateAsync } from '../audit/mutate';
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
  list(companyId: number): Promise<SplitPresetRow[]>;
  add(companyId: number, input: { name: string; lines: SplitLine[] }, userId: number): Promise<SplitPresetRow>;
  update(companyId: number, id: number, input: { name?: string; lines?: SplitLine[] }, userId: number): Promise<SplitPresetRow>;
  archive(companyId: number, id: number, userId: number): Promise<SplitPresetRow>;
  unarchive(companyId: number, id: number, userId: number): Promise<SplitPresetRow>;
  reorder(companyId: number, ids: number[], userId: number): Promise<SplitPresetRow[]>;
  remove(companyId: number, id: number, userId: number): Promise<void>;
}

const ENTITY = 'split_preset';

function toRow(r: typeof splitPresets.$inferSelect): SplitPresetRow {
  return { ...r, lines: JSON.parse(r.lines) as SplitLine[] };
}

const invalidLines = (message: string) => new AppError(400, 'VALIDATION', 'Проверьте заполнение полей', { lines: message });

export function createSplitPresetsService(d: { db: Db; audit: AuditService; now?: () => Date }): SplitPresetsService {
  const { db, audit } = d;
  const now = d.now ?? (() => new Date());

  async function requireRow(companyId: number, id: number): Promise<SplitPresetRow> {
    const row = await first(db.select().from(splitPresets).where(and(eq(splitPresets.id, id), eq(splitPresets.companyId, companyId))));
    if (!row) throw new AppError(404, 'NOT_FOUND', 'Шаблон разделения не найден');
    return toRow(row);
  }

  /** Категории и проекты строк: той же компании (инвариант 5), не в архиве (инвариант 7), категории одного вида. */
  async function checkRefs(companyId: number, lines: SplitLine[]): Promise<void> {
    const catIds = [...new Set(lines.flatMap((l) => (l.categoryId === null ? [] : [l.categoryId])))];
    const projIds = [...new Set(lines.flatMap((l) => (l.projectId === null ? [] : [l.projectId])))];
    const cats = catIds.length
      ? await db.select().from(categories).where(and(eq(categories.companyId, companyId), inArray(categories.id, catIds)))
      : [];
    const projs = projIds.length
      ? await db.select().from(projects).where(and(eq(projects.companyId, companyId), inArray(projects.id, projIds)))
      : [];
    if (cats.length !== catIds.length) throw invalidLines('Категория не найдена в этой компании');
    if (projs.length !== projIds.length) throw invalidLines('Проект не найден в этой компании');
    if (new Set(cats.map((c) => c.kind)).size > 1) throw invalidLines('Категории шаблона должны быть одного вида');
    const archived = [...cats, ...projs].find((x) => x.archivedAt);
    if (archived) throw new AppError(422, 'ARCHIVED_REFERENCE', `«${archived.name}» в архиве — выберите другой элемент`);
  }

  async function setArchived(companyId: number, id: number, userId: number, archive: boolean): Promise<SplitPresetRow> {
    await requireCompany(db, companyId, { writable: true });
    const row = await requireRow(companyId, id);
    if ((row.archivedAt !== null) === archive) return row;
    return mutateAsync(db, audit, async (tx, record) => {
      const [out] = await tx
        .update(splitPresets)
        .set({ archivedAt: archive ? now().toISOString() : null })
        .where(eq(splitPresets.id, id))
        .returning();
      await record({ companyId, userId, entity: ENTITY, entityId: id, action: archive ? 'archive' : 'unarchive' });
      return toRow(out!);
    });
  }

  const svc: SplitPresetsService = {
    async list(companyId) {
      await requireCompany(db, companyId);
      const rows = await db
        .select()
        .from(splitPresets)
        .where(eq(splitPresets.companyId, companyId))
        .orderBy(asc(splitPresets.orderIndex), asc(splitPresets.id));
      return rows.map(toRow);
    },

    async add(companyId, input, userId) {
      await requireCompany(db, companyId, { writable: true });
      await checkRefs(companyId, input.lines);
      return mutateAsync(db, audit, async (tx, record) => {
        const next = await first(
          tx
            .select({ m: sql<number>`coalesce(max(${splitPresets.orderIndex}), -1)` })
            .from(splitPresets)
            .where(eq(splitPresets.companyId, companyId)),
        );
        const [inserted] = await tx
          .insert(splitPresets)
          .values({
            companyId,
            name: cleanName(input.name),
            lines: JSON.stringify(input.lines),
            orderIndex: (next?.m ?? -1) + 1,
            createdAt: now().toISOString(),
          })
          .returning();
        const row = toRow(inserted!);
        await record({ companyId, userId, entity: ENTITY, entityId: row.id, action: 'create', diff: { name: row.name, lines: row.lines } });
        return row;
      });
    },

    async update(companyId, id, input, userId) {
      await requireCompany(db, companyId, { writable: true });
      const before = await requireRow(companyId, id);
      if (before.archivedAt) throw new AppError(422, 'ARCHIVED_REFERENCE', 'Шаблон в архиве — сначала верните его из архива');
      const patch = { ...input, ...(input.name !== undefined ? { name: cleanName(input.name) } : {}) };
      const changes = changedFields({ name: before.name, lines: before.lines }, patch);
      if (!changes) return before;
      const { name, lines } = changes.after;
      if (lines !== undefined) await checkRefs(companyId, lines); // старые строки не перепроверяем (инвариант 10)
      return mutateAsync(db, audit, async (tx, record) => {
        const [row] = await tx
          .update(splitPresets)
          .set({ ...(name !== undefined ? { name } : {}), ...(lines !== undefined ? { lines: JSON.stringify(lines) } : {}) })
          .where(eq(splitPresets.id, id))
          .returning();
        await record({ companyId, userId, entity: ENTITY, entityId: id, action: 'update', diff: changes });
        return toRow(row!);
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
          for (const [i, rowId] of ids.entries()) await tx.update(splitPresets).set({ orderIndex: i }).where(eq(splitPresets.id, rowId));
          await record({ companyId, userId, entity: ENTITY, action: 'reorder', diff: { ids } });
        });
      }
      return svc.list(companyId);
    },

    async remove(companyId, id, userId) {
      await requireCompany(db, companyId, { writable: true });
      const row = await requireRow(companyId, id);
      // на шаблоны разделения операции не ссылаются — удаление всегда возможно
      await mutateAsync(db, audit, async (tx, record) => {
        await tx.delete(splitPresets).where(eq(splitPresets.id, id));
        await record({ companyId, userId, entity: ENTITY, entityId: id, action: 'delete', diff: { name: row.name } });
      });
    },
  };
  return svc;
}
