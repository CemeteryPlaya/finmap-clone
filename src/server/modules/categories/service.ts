import { and, asc, count, eq, isNull, sql, type SQL } from 'drizzle-orm';
import { effectiveSystemKey, SYSTEM_CATEGORIES, systemCategory, type CategoryKind, type SystemKey } from '../../../shared/system-categories';
import { cleanName } from '../../../shared/text';
import { isUnderSystem, type BusinessTemplate } from '../../../templates/types';
import type { Db, Executor } from '../../db/client';
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
  seedSystem(ex: Executor, companyId: number): void;
  mergeTemplate(ex: Executor, companyId: number, template: BusinessTemplate): number;
  /**
   * Низкоуровневое создание внутри чужой транзакции (импорт, §6.4 спецификации импорта): без истории — её пишет
   * вызывающий. Порядок — после имеющихся на своём уровне; родитель — верхнего уровня того же вида и компании.
   */
  createIn(ex: Executor, input: { companyId: number; kind: CategoryKind; parentId: number | null; name: string }): CategoryRow;
  listTree(companyId: number): { income: CategoryNodeDto[]; expense: CategoryNodeDto[] };
  add(companyId: number, input: { kind: CategoryKind; name: string; parentId: number | null }, userId: number): CategoryRow;
  rename(companyId: number, id: number, name: string, userId: number): CategoryRow;
  /** Новый порядок детей parentId (null — верхний уровень) дерева kind; moving — единственная категория, переносимая сюда из другого места. */
  move(companyId: number, input: { kind: CategoryKind; parentId: number | null; ids: number[]; moving?: number | null }, userId: number): void;
  archive(companyId: number, id: number, userId: number): CategoryRow;
  unarchive(companyId: number, id: number, userId: number): CategoryRow;
  remove(companyId: number, id: number, userId: number): void;
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

  function nextOrder(ex: Executor, companyId: number, kind: CategoryKind, parentId: number | null): number {
    const row = ex
      .select({ m: sql<number>`coalesce(max(${categories.orderIndex}), -1)` })
      .from(categories)
      .where(levelCondition(companyId, kind, parentId))
      .get();
    return (row?.m ?? -1) + 1;
  }

  function insert(
    ex: Executor,
    v: { companyId: number; kind: CategoryKind; parentId: number | null; name: string; systemKey?: SystemKey; templateRef?: string },
  ) {
    return ex
      .insert(categories)
      .values({
        companyId: v.companyId,
        kind: v.kind,
        parentId: v.parentId,
        name: v.name,
        systemKey: v.systemKey ?? null,
        templateRef: v.templateRef ?? null,
        orderIndex: nextOrder(ex, v.companyId, v.kind, v.parentId),
        createdAt: now().toISOString(),
      })
      .returning()
      .get();
  }

  function findByRef(ex: Executor, companyId: number, kind: CategoryKind, ref: string) {
    return ex
      .select()
      .from(categories)
      .where(and(eq(categories.companyId, companyId), eq(categories.kind, kind), eq(categories.templateRef, ref)))
      .get();
  }

  function find(companyId: number, id: number) {
    return db.select().from(categories).where(and(eq(categories.id, id), eq(categories.companyId, companyId))).get();
  }

  function requireCategory(companyId: number, id: number): CategoryRow {
    const r = find(companyId, id);
    if (!r) throw new AppError(404, 'NOT_FOUND', 'Категория не найдена');
    return toRow(r);
  }

  function childIds(companyId: number, kind: CategoryKind, parentId: number | null): number[] {
    return db
      .select({ id: categories.id })
      .from(categories)
      .where(levelCondition(companyId, kind, parentId))
      .orderBy(asc(categories.orderIndex), asc(categories.id))
      .all()
      .map((r) => r.id);
  }

  function hasChildren(id: number, activeOnly = false): boolean {
    const conds: SQL[] = [eq(categories.parentId, id)];
    if (activeOnly) conds.push(isNull(categories.archivedAt));
    return (db.select({ n: count() }).from(categories).where(and(...conds)).get()?.n ?? 0) > 0;
  }

  /** Родитель для вложения: та же компания и вид, верхний уровень, не в архиве (вложенность ≤ 2). */
  function checkParent(companyId: number, kind: CategoryKind, parentId: number, opts: { allowArchived?: boolean } = {}): void {
    const p = find(companyId, parentId);
    if (!p) throw invalid('parentId', 'Родительская категория не найдена');
    if (p.kind !== kind) throw invalid('parentId', 'Родительская категория из другого дерева');
    if (p.parentId !== null) throw invalid('parentId', 'Вложенность — не больше двух уровней');
    if (p.archivedAt && !opts.allowArchived) throw new AppError(422, 'ARCHIVED_REFERENCE', 'Родительская категория в архиве');
  }

  function setArchived(companyId: number, id: number, userId: number, archivedAt: string | null): CategoryRow {
    return mutate(db, audit, (tx, record) => {
      const out = toRow(tx.update(categories).set({ archivedAt }).where(eq(categories.id, id)).returning().get());
      record({ companyId, userId, entity: 'category', entityId: id, action: archivedAt ? 'archive' : 'unarchive' });
      return out;
    });
  }

  const svc: CategoriesService = {
    seedSystem(ex, companyId) {
      for (const def of SYSTEM_CATEGORIES) {
        insert(ex, { companyId, kind: def.kind, parentId: null, name: def.name, systemKey: def.key });
      }
    },

    mergeTemplate(ex, companyId, template) {
      let created = 0;
      for (const kind of ['income', 'expense'] as const) {
        for (const node of template.categories[kind]) {
          let parentId: number | null;
          if (isUnderSystem(node)) {
            if (systemCategory(node.underSystem).kind !== kind) {
              throw new Error(`Системная категория ${node.underSystem} не относится к виду ${kind}`);
            }
            const sys = ex
              .select()
              .from(categories)
              .where(and(eq(categories.companyId, companyId), eq(categories.kind, kind), eq(categories.systemKey, node.underSystem)))
              .get();
            if (!sys) throw new Error(`В компании ${companyId} нет системной категории ${node.underSystem}`);
            parentId = sys.id;
          } else {
            const existing = findByRef(ex, companyId, kind, node.ref);
            if (existing) {
              // группу перенесли во второй уровень или в архив — новые дочерние встают на верхний уровень
              parentId = existing.parentId === null && !existing.archivedAt ? existing.id : null;
            } else {
              parentId = insert(ex, { companyId, kind, parentId: null, name: node.name, templateRef: node.ref }).id;
              created++;
            }
          }
          for (const child of node.children ?? []) {
            if (findByRef(ex, companyId, kind, child.ref)) continue;
            insert(ex, { companyId, kind, parentId, name: child.name, templateRef: child.ref });
            created++;
          }
        }
      }
      return created;
    },

    createIn(ex, input) {
      if (input.parentId !== null) {
        const p = ex.select().from(categories).where(and(eq(categories.id, input.parentId), eq(categories.companyId, input.companyId))).get();
        if (!p || p.kind !== input.kind || p.parentId !== null) throw new Error(`Категория ${input.parentId} не может быть родителем`);
      }
      return toRow(insert(ex, { companyId: input.companyId, kind: input.kind, parentId: input.parentId, name: cleanName(input.name) }));
    },

    listTree(companyId) {
      const rows = db
        .select()
        .from(categories)
        .where(eq(categories.companyId, companyId))
        .orderBy(asc(categories.orderIndex), asc(categories.id))
        .all()
        .map(toRow);
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

    add(companyId, input, userId) {
      requireCompany(db, companyId, { writable: true });
      if (input.parentId !== null) checkParent(companyId, input.kind, input.parentId);
      return mutate(db, audit, (tx, record) => {
        const row = toRow(insert(tx, { companyId, kind: input.kind, parentId: input.parentId, name: cleanName(input.name) }));
        record({ companyId, userId, entity: 'category', entityId: row.id, action: 'create', diff: { kind: row.kind, name: row.name, parentId: row.parentId } });
        return row;
      });
    },

    rename(companyId, id, name, userId) {
      requireCompany(db, companyId, { writable: true });
      const before = requireCategory(companyId, id);
      if (before.systemKey) throw new AppError(422, 'SYSTEM_CATEGORY', 'Системную категорию нельзя переименовать');
      if (before.archivedAt) throw new AppError(422, 'ARCHIVED_REFERENCE', 'Категория в архиве — сначала верните её из архива');
      const changes = changedFields({ name: before.name }, { name: cleanName(name) });
      if (!changes) return before;
      return mutate(db, audit, (tx, record) => {
        const row = toRow(tx.update(categories).set(changes.after).where(eq(categories.id, id)).returning().get());
        record({ companyId, userId, entity: 'category', entityId: id, action: 'update', diff: changes });
        return row;
      });
    },

    move(companyId, { kind, parentId, ids, moving = null }, userId) {
      requireCompany(db, companyId, { writable: true });
      // порядок детей архивной группы менять можно; нельзя только переносить категорию внутрь архивной
      if (parentId !== null) checkParent(companyId, kind, parentId, { allowArchived: true });
      const current = childIds(companyId, kind, parentId);
      if (parentId !== null && moving !== null && !current.includes(moving)) checkParent(companyId, kind, parentId);
      const stale = () => new AppError(409, 'VERSION_CONFLICT', 'Список изменился — обновите страницу и повторите');
      if (new Set(ids).size !== ids.length || current.some((id) => !ids.includes(id))) throw stale();
      const moved: number[] = [];
      for (const id of ids) {
        if (current.includes(id)) continue;
        const c = requireCategory(companyId, id); // чужой id — 404
        // переносится только явно названная категория; любая другая «лишняя» значит, что экран устарел
        // (её уже перенёс другой пользователь) — молча вернуть её назад нельзя
        if (id !== moving) throw stale();
        if (c.kind !== kind) throw invalid('ids', 'Категорию нельзя перенести в дерево другого вида');
        if (parentId !== null) {
          if (c.systemKey) throw new AppError(422, 'SYSTEM_CATEGORY', 'Системная категория остаётся на верхнем уровне');
          if (c.id === parentId) throw invalid('ids', 'Категорию нельзя вложить в саму себя');
          if (hasChildren(c.id)) throw invalid('ids', 'Категорию с дочерними нельзя сделать дочерней');
        }
        if (c.archivedAt) throw new AppError(422, 'ARCHIVED_REFERENCE', 'Категория в архиве — сначала верните её из архива');
        moved.push(id);
      }
      if (moved.length === 0 && isSameOrder(current, ids)) return;
      mutate(db, audit, (tx, record) => {
        ids.forEach((categoryId, i) => tx.update(categories).set({ parentId, orderIndex: i }).where(eq(categories.id, categoryId)).run());
        record({ companyId, userId, entity: 'category', action: 'reorder', diff: { kind, parentId, ids, moved } });
      });
    },

    archive(companyId, id, userId) {
      requireCompany(db, companyId, { writable: true });
      const row = requireCategory(companyId, id);
      if (row.systemKey) throw new AppError(422, 'ARCHIVED_REFERENCE', 'Системные категории не архивируются');
      if (row.archivedAt) return row;
      if (hasChildren(id, true)) throw new AppError(422, 'ARCHIVED_REFERENCE', 'Сначала переведите в архив дочерние категории');
      return setArchived(companyId, id, userId, now().toISOString());
    },

    unarchive(companyId, id, userId) {
      requireCompany(db, companyId, { writable: true });
      const row = requireCategory(companyId, id);
      if (!row.archivedAt) return row;
      if (row.parentId !== null && find(companyId, row.parentId)?.archivedAt) {
        throw new AppError(422, 'ARCHIVED_REFERENCE', 'Сначала верните из архива родительскую категорию');
      }
      return setArchived(companyId, id, userId, null);
    },

    remove(companyId, id, userId) {
      requireCompany(db, companyId, { writable: true });
      const row = requireCategory(companyId, id);
      if (row.systemKey) throw new AppError(422, 'SYSTEM_CATEGORY', 'Системную категорию нельзя удалить');
      if (hasChildren(id)) throw new AppError(422, 'IN_USE', 'Сначала удалите или перенесите дочерние категории');
      if (references.countOperations('category', id) > 0) {
        throw new AppError(422, 'INVARIANT_9', 'На категорию ссылаются операции — её можно только перевести в архив');
      }
      mutate(db, audit, (tx, record) => {
        tx.delete(categories).where(eq(categories.id, id)).run();
        record({ companyId, userId, entity: 'category', entityId: id, action: 'delete', diff: { kind: row.kind, name: row.name, parentId: row.parentId } });
      });
    },
  };
  return svc;
}
