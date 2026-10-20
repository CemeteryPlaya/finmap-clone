import { and, asc, count, eq, isNull, sql, type SQL } from 'drizzle-orm';
import { effectiveSystemKey, SYSTEM_CATEGORIES, systemCategory, type CategoryKind, type SystemKey } from '../../../shared/system-categories';
import { cleanName } from '../../../shared/text';
import { isUnderSystem, type BusinessTemplate } from '../../../templates/types';
import type { Db, Executor } from '../../db/client';
import { first } from '../../db/raw';
import { categories } from '../../db/schema';
import { AppError } from '../../errors';
import { changedFields, mutate } from '../audit/mutate';
import type { AuditService } from '../audit/service';
import { requireCompany } from '../companies/guard';
import { isSameOrder } from '../dictionaries/order';
import { createReferencesService, type ReferencesService } from '../references/service';

export interface CategoryRow {
  id: number;
  companyId: number;
  kind: CategoryKind;
  parentId: number | null;
  name: string;
  systemKey: SystemKey | null;
  templateRef: string | null;
  orderIndex: number;
  archivedAt: string | null;
}

export interface CategoryNodeDto extends CategoryRow {
  effectiveSystemKey: SystemKey | null;
  children: CategoryNodeDto[];
}

export interface CategoriesService {
  seedSystem(ex: Executor, companyId: number): Promise<void>;
  mergeTemplate(ex: Executor, companyId: number, template: BusinessTemplate): Promise<number>;
  /**
   * Низкоуровневое создание внутри чужой транзакции (импорт, §6.4 спецификации импорта): без истории — её пишет
   * вызывающий. Порядок — после имеющихся на своём уровне; родитель — верхнего уровня того же вида и компании, не в архиве (как у add).
   */
  createIn(ex: Executor, input: { companyId: number; kind: CategoryKind; parentId: number | null; name: string }): Promise<CategoryRow>;
  listTree(companyId: number): Promise<{ income: CategoryNodeDto[]; expense: CategoryNodeDto[] }>;
  add(companyId: number, input: { kind: CategoryKind; name: string; parentId: number | null }, userId: number): Promise<CategoryRow>;
  rename(companyId: number, id: number, name: string, userId: number): Promise<CategoryRow>;
  /** Новый порядок детей parentId (null — верхний уровень) дерева kind; moving — единственная категория, переносимая сюда из другого места. */
  move(companyId: number, input: { kind: CategoryKind; parentId: number | null; ids: number[]; moving?: number | null }, userId: number): Promise<void>;
  archive(companyId: number, id: number, userId: number): Promise<CategoryRow>;
  unarchive(companyId: number, id: number, userId: number): Promise<CategoryRow>;
  remove(companyId: number, id: number, userId: number): Promise<void>;
}

function toRow(r: typeof categories.$inferSelect): CategoryRow {
  return {
    id: r.id,
    companyId: r.companyId,
    kind: r.kind,
    parentId: r.parentId,
    name: r.name,
    systemKey: r.systemKey as SystemKey | null,
    templateRef: r.templateRef,
    orderIndex: r.orderIndex,
    archivedAt: r.archivedAt,
  };
}

const invalid = (field: string, message: string) => new AppError(400, 'VALIDATION', 'Проверьте заполнение полей', { [field]: message });

export function createCategoriesService(d: { db: Db; audit: AuditService; references?: ReferencesService; now?: () => Date }): CategoriesService {
  const { db, audit } = d;
  const now = d.now ?? (() => new Date());
  const references = d.references ?? createReferencesService();

  function levelCondition(companyId: number, kind: CategoryKind, parentId: number | null): SQL | undefined {
    return and(
      eq(categories.companyId, companyId),
      eq(categories.kind, kind),
      parentId === null ? isNull(categories.parentId) : eq(categories.parentId, parentId),
    );
  }

  async function nextOrder(ex: Executor, companyId: number, kind: CategoryKind, parentId: number | null): Promise<number> {
    const row = await first(
      ex
        .select({ m: sql<number>`coalesce(max(${categories.orderIndex}), -1)` })
        .from(categories)
        .where(levelCondition(companyId, kind, parentId)),
    );
    return Number(row?.m ?? -1) + 1;
  }

  async function insert(
    ex: Executor,
    v: { companyId: number; kind: CategoryKind; parentId: number | null; name: string; systemKey?: SystemKey; templateRef?: string },
  ) {
    const [row] = await ex
      .insert(categories)
      .values({
        companyId: v.companyId,
        kind: v.kind,
        parentId: v.parentId,
        name: v.name,
        systemKey: v.systemKey ?? null,
        templateRef: v.templateRef ?? null,
        orderIndex: await nextOrder(ex, v.companyId, v.kind, v.parentId),
        createdAt: now().toISOString(),
      })
      .returning();
    return row!;
  }

  function findByRef(ex: Executor, companyId: number, kind: CategoryKind, ref: string) {
    return first(
      ex
        .select()
        .from(categories)
        .where(and(eq(categories.companyId, companyId), eq(categories.kind, kind), eq(categories.templateRef, ref))),
    );
  }

  function find(companyId: number, id: number, ex: Executor = db) {
    return first(ex.select().from(categories).where(and(eq(categories.id, id), eq(categories.companyId, companyId))));
  }

  async function requireCategory(companyId: number, id: number): Promise<CategoryRow> {
    const r = await find(companyId, id);
    if (!r) throw new AppError(404, 'NOT_FOUND', 'Категория не найдена');
    return toRow(r);
  }

  async function childIds(companyId: number, kind: CategoryKind, parentId: number | null): Promise<number[]> {
    return (
      await db
        .select({ id: categories.id })
        .from(categories)
        .where(levelCondition(companyId, kind, parentId))
        .orderBy(asc(categories.orderIndex), asc(categories.id))
    ).map((r) => r.id);
  }

  async function hasChildren(id: number, activeOnly = false): Promise<boolean> {
    const conds: SQL[] = [eq(categories.parentId, id)];
    if (activeOnly) conds.push(isNull(categories.archivedAt));
    return Number((await first(db.select({ n: count() }).from(categories).where(and(...conds))))?.n ?? 0) > 0;
  }

  /** Родитель для вложения: та же компания и вид, верхний уровень, не в архиве (вложенность ≤ 2). */
  async function checkParent(companyId: number, kind: CategoryKind, parentId: number, opts: { allowArchived?: boolean } = {}, ex: Executor = db): Promise<void> {
    const p = await find(companyId, parentId, ex);
    if (!p) throw invalid('parentId', 'Родительская категория не найдена');
    if (p.kind !== kind) throw invalid('parentId', 'Родительская категория из другого дерева');
    if (p.parentId !== null) throw invalid('parentId', 'Вложенность — не больше двух уровней');
    if (p.archivedAt && !opts.allowArchived) throw new AppError(422, 'ARCHIVED_REFERENCE', 'Родительская категория в архиве');
  }

  function setArchived(companyId: number, id: number, userId: number, archivedAt: string | null): Promise<CategoryRow> {
    return mutate(db, audit, async (tx, record) => {
      const [updated] = await tx.update(categories).set({ archivedAt }).where(eq(categories.id, id)).returning();
      await record({ companyId, userId, entity: 'category', entityId: id, action: archivedAt ? 'archive' : 'unarchive' });
      return toRow(updated!);
    });
  }

  const svc: CategoriesService = {
    async seedSystem(ex, companyId) {
      for (const def of SYSTEM_CATEGORIES) {
        await insert(ex, { companyId, kind: def.kind, parentId: null, name: def.name, systemKey: def.key });
      }
    },

    async mergeTemplate(ex, companyId, template) {
      let created = 0;
      for (const kind of ['income', 'expense'] as const) {
        for (const node of template.categories[kind]) {
          let parentId: number | null;
          if (isUnderSystem(node)) {
            if (systemCategory(node.underSystem).kind !== kind) {
              throw new Error(`Системная категория ${node.underSystem} не относится к виду ${kind}`);
            }
            const sys = await first(
              ex
                .select()
                .from(categories)
                .where(and(eq(categories.companyId, companyId), eq(categories.kind, kind), eq(categories.systemKey, node.underSystem))),
            );
            if (!sys) throw new Error(`В компании ${companyId} нет системной категории ${node.underSystem}`);
            parentId = sys.id;
          } else {
            const existing = await findByRef(ex, companyId, kind, node.ref);
            if (existing) {
              // группу перенесли во второй уровень или в архив — новые дочерние встают на верхний уровень
              parentId = existing.parentId === null && !existing.archivedAt ? existing.id : null;
            } else {
              parentId = (await insert(ex, { companyId, kind, parentId: null, name: node.name, templateRef: node.ref })).id;
              created++;
            }
          }
          for (const child of node.children ?? []) {
            if (await findByRef(ex, companyId, kind, child.ref)) continue;
            await insert(ex, { companyId, kind, parentId, name: child.name, templateRef: child.ref });
            created++;
          }
        }
      }
      return created;
    },

    async createIn(ex, input) {
      if (input.parentId !== null) await checkParent(input.companyId, input.kind, input.parentId, {}, ex);
      return toRow(await insert(ex, { companyId: input.companyId, kind: input.kind, parentId: input.parentId, name: cleanName(input.name) }));
    },

    async listTree(companyId) {
      const rows = (await db.select().from(categories).where(eq(categories.companyId, companyId)).orderBy(asc(categories.orderIndex), asc(categories.id))).map(
        toRow,
      );
      const byId = new Map<number, CategoryNodeDto>();
      for (const r of rows) byId.set(r.id, { ...r, effectiveSystemKey: r.systemKey, children: [] });
      const result = { income: [] as CategoryNodeDto[], expense: [] as CategoryNodeDto[] };
      for (const node of byId.values()) {
        const parent = node.parentId === null ? undefined : byId.get(node.parentId);
        if (parent) {
          node.effectiveSystemKey = effectiveSystemKey(node.systemKey, parent.systemKey);
          parent.children.push(node);
        } else {
          result[node.kind].push(node);
        }
      }
      return result;
    },

    async add(companyId, input, userId) {
      await requireCompany(db, companyId, { writable: true });
      return mutate(db, audit, async (tx, record) => {
        const row = await svc.createIn(tx, { companyId, kind: input.kind, parentId: input.parentId, name: input.name });
        await record({ companyId, userId, entity: 'category', entityId: row.id, action: 'create', diff: { kind: row.kind, name: row.name, parentId: row.parentId } });
        return row;
      });
    },

    async rename(companyId, id, name, userId) {
      await requireCompany(db, companyId, { writable: true });
      const before = await requireCategory(companyId, id);
      if (before.systemKey) throw new AppError(422, 'SYSTEM_CATEGORY', 'Системную категорию нельзя переименовать');
      if (before.archivedAt) throw new AppError(422, 'ARCHIVED_REFERENCE', 'Категория в архиве — сначала верните её из архива');
      const changes = changedFields({ name: before.name }, { name: cleanName(name) });
      if (!changes) return before;
      return mutate(db, audit, async (tx, record) => {
        const [updated] = await tx.update(categories).set(changes.after).where(eq(categories.id, id)).returning();
        await record({ companyId, userId, entity: 'category', entityId: id, action: 'update', diff: changes });
        return toRow(updated!);
      });
    },

    async move(companyId, { kind, parentId, ids, moving = null }, userId) {
      await requireCompany(db, companyId, { writable: true });
      // порядок детей архивной группы менять можно; нельзя только переносить категорию внутрь архивной
      if (parentId !== null) await checkParent(companyId, kind, parentId, { allowArchived: true });
      const current = await childIds(companyId, kind, parentId);
      if (parentId !== null && moving !== null && !current.includes(moving)) await checkParent(companyId, kind, parentId);
      const stale = () => new AppError(409, 'VERSION_CONFLICT', 'Список изменился — обновите страницу и повторите');
      if (new Set(ids).size !== ids.length || current.some((id) => !ids.includes(id))) throw stale();
      const moved: number[] = [];
      for (const id of ids) {
        if (current.includes(id)) continue;
        const c = await requireCategory(companyId, id); // чужой id — 404
        // переносится только явно названная категория; любая другая «лишняя» значит, что экран устарел
        // (её уже перенёс другой пользователь) — молча вернуть её назад нельзя
        if (id !== moving) throw stale();
        if (c.kind !== kind) throw invalid('ids', 'Категорию нельзя перенести в дерево другого вида');
        if (parentId !== null) {
          if (c.systemKey) throw new AppError(422, 'SYSTEM_CATEGORY', 'Системная категория остаётся на верхнем уровне');
          if (c.id === parentId) throw invalid('ids', 'Категорию нельзя вложить в саму себя');
          if (await hasChildren(c.id)) throw invalid('ids', 'Категорию с дочерними нельзя сделать дочерней');
        }
        if (c.archivedAt) throw new AppError(422, 'ARCHIVED_REFERENCE', 'Категория в архиве — сначала верните её из архива');
        moved.push(id);
      }
      if (moved.length === 0 && isSameOrder(current, ids)) return;
      await mutate(db, audit, async (tx, record) => {
        for (const [i, categoryId] of ids.entries()) await tx.update(categories).set({ parentId, orderIndex: i }).where(eq(categories.id, categoryId));
        await record({ companyId, userId, entity: 'category', action: 'reorder', diff: { kind, parentId, ids, moved } });
      });
    },

    async archive(companyId, id, userId) {
      await requireCompany(db, companyId, { writable: true });
      const row = await requireCategory(companyId, id);
      if (row.systemKey) throw new AppError(422, 'ARCHIVED_REFERENCE', 'Системные категории не архивируются');
      if (row.archivedAt) return row;
      if (await hasChildren(id, true)) throw new AppError(422, 'ARCHIVED_REFERENCE', 'Сначала переведите в архив дочерние категории');
      return setArchived(companyId, id, userId, now().toISOString());
    },

    async unarchive(companyId, id, userId) {
      await requireCompany(db, companyId, { writable: true });
      const row = await requireCategory(companyId, id);
      if (!row.archivedAt) return row;
      if (row.parentId !== null && (await find(companyId, row.parentId))?.archivedAt) {
        throw new AppError(422, 'ARCHIVED_REFERENCE', 'Сначала верните из архива родительскую категорию');
      }
      return setArchived(companyId, id, userId, null);
    },

    async remove(companyId, id, userId) {
      await requireCompany(db, companyId, { writable: true });
      const row = await requireCategory(companyId, id);
      if (row.systemKey) throw new AppError(422, 'SYSTEM_CATEGORY', 'Системную категорию нельзя удалить');
      if (await hasChildren(id)) throw new AppError(422, 'IN_USE', 'Сначала удалите или перенесите дочерние категории');
      if ((await references.countOperations('category', id)) > 0) {
        throw new AppError(422, 'INVARIANT_9', 'На категорию ссылаются операции — её можно только перевести в архив');
      }
      await mutate(db, audit, async (tx, record) => {
        await tx.delete(categories).where(eq(categories.id, id));
        await record({ companyId, userId, entity: 'category', entityId: id, action: 'delete', diff: { kind: row.kind, name: row.name, parentId: row.parentId } });
      });
    },
  };
  return svc;
}
