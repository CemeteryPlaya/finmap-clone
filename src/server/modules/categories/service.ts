import { and, asc, eq, isNull, sql } from 'drizzle-orm';
import { effectiveSystemKey, SYSTEM_CATEGORIES, systemCategory, type CategoryKind, type SystemKey } from '../../../shared/system-categories';
import { isUnderSystem, type BusinessTemplate } from '../../../templates/types';
import type { Db, Executor } from '../../db/client';
import { categories } from '../../db/schema';

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
  listTree(companyId: number): { income: CategoryNodeDto[]; expense: CategoryNodeDto[] };
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

export function createCategoriesService(db: Db, now: () => Date = () => new Date()): CategoriesService {
  function nextOrder(ex: Executor, companyId: number, kind: CategoryKind, parentId: number | null): number {
    const row = ex
      .select({ m: sql<number>`coalesce(max(${categories.orderIndex}), -1)` })
      .from(categories)
      .where(
        and(
          eq(categories.companyId, companyId),
          eq(categories.kind, kind),
          parentId === null ? isNull(categories.parentId) : eq(categories.parentId, parentId),
        ),
      )
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

  return {
    seedSystem(ex, companyId) {
      for (const def of SYSTEM_CATEGORIES) {
        insert(ex, { companyId, kind: def.kind, parentId: null, name: def.name, systemKey: def.key });
      }
    },

    mergeTemplate(ex, companyId, template) {
      let created = 0;
      for (const kind of ['income', 'expense'] as const) {
        for (const node of template.categories[kind]) {
          let parentId: number;
          if (isUnderSystem(node)) {
            if (systemCategory(node.underSystem).kind !== kind) {
              throw new Error(`Системная статья ${node.underSystem} не относится к виду ${kind}`);
            }
            const sys = ex
              .select()
              .from(categories)
              .where(and(eq(categories.companyId, companyId), eq(categories.kind, kind), eq(categories.systemKey, node.underSystem)))
              .get();
            if (!sys) throw new Error(`В компании ${companyId} нет системной статьи ${node.underSystem}`);
            parentId = sys.id;
          } else {
            const existing = findByRef(ex, companyId, kind, node.ref);
            if (existing) parentId = existing.id;
            else {
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
  };
}
