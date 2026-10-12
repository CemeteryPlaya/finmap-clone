import { moveError, type MovePlan } from './category-moves';
import { mergeSubsetOrder, sortByIds } from './order';
import type { CategoryNode, CategoryTree } from './queries';
import { moveGroup, shiftInGroup, visibleRows, type SettingsRow } from './settings-list';

/** Пункт подменю «Категорий» (§7.2 этапа 1.5), `?tab=` адреса. */
export type CategoryTab = 'system-income' | 'system-expense' | 'my-income' | 'my-expense';

export interface CategoryTabInfo {
  tab: CategoryTab;
  label: string;
  kind: 'income' | 'expense';
  /** Системные категории (иконка «банк»), иначе свои. */
  system: boolean;
}

export const CATEGORY_TABS: readonly CategoryTabInfo[] = [
  { tab: 'system-income', label: 'Системные категории дохода', kind: 'income', system: true },
  { tab: 'system-expense', label: 'Системные категории расхода', kind: 'expense', system: true },
  { tab: 'my-income', label: 'Мои категории дохода', kind: 'income', system: false },
  { tab: 'my-expense', label: 'Мои категории расхода', kind: 'expense', system: false },
];

export const DEFAULT_CATEGORY_TAB: CategoryTab = 'my-expense';

/** `?tab=` адреса: известный пункт — он, иначе «Мои категории расхода» (§4.2). */
export function categoryTab(param: string | null): CategoryTab {
  return CATEGORY_TABS.find((t) => t.tab === param)?.tab ?? DEFAULT_CATEGORY_TAB;
}

export function categoryTabInfo(tab: CategoryTab): CategoryTabInfo {
  return CATEGORY_TABS.find((t) => t.tab === tab) ?? CATEGORY_TABS[CATEGORY_TABS.length - 1]!;
}

/** Строка списка категорий: сама категория, системная ли она, верхний ли уровень. */
export interface CategoryRow extends SettingsRow {
  node: CategoryNode;
  system: boolean;
  topLevel: boolean;
}

/**
 * Строки вкладки: категории верхнего уровня вида — системные или свои, под каждой её дочерние (§7.2). Имена категорий
 * не уникальны: у подкатегорий ✎ и ☰ называют и родителя — «Изменить Зал в Аренда» (M6 итогов плана 1.5-4b).
 */
export function categoryRows(tree: CategoryTree, tab: CategoryTab): CategoryRow[] {
  const info = categoryTabInfo(tab);
  return tree[info.kind]
    .filter((n) => (n.systemKey !== null) === info.system)
    .flatMap((n) => [
      { id: n.id, name: n.name, archived: n.archivedAt !== null, parentId: null, node: n, system: n.systemKey !== null, topLevel: true },
      ...n.children.map((c) => ({
        id: c.id,
        name: c.name,
        editLabel: `Изменить ${c.name} в ${n.name}`,
        moveLabel: `Переместить ${c.name} в ${n.name}`,
        archived: c.archivedAt !== null,
        parentId: n.id,
        node: c,
        system: c.systemKey !== null,
        topLevel: false,
      })),
    ]);
}

/**
 * Тело POST /categories/reorder для новой группы вкладки (соседи одного уровня в новом порядке). На верхнем
 * уровне свои и системные — соседи: группа встаёт в полный список уровня на свои места, остальные не сдвигаются.
 */
export function categoryReorderPlan(tree: CategoryTree, tab: CategoryTab, group: readonly number[]): MovePlan | null {
  const { kind } = categoryTabInfo(tab);
  const level = tree[kind];
  const first = group[0];
  if (first === undefined) return null;
  if (level.some((n) => n.id === first)) {
    return { kind, parentId: null, ids: mergeSubsetOrder(level.map((n) => n.id), group), moving: null };
  }
  const parent = level.find((n) => n.children.some((c) => c.id === first));
  if (!parent) return null;
  return { kind, parentId: parent.id, ids: mergeSubsetOrder(parent.children.map((c) => c.id), group), moving: null };
}

/** «Перенести в…»: «Верхний уровень», текущий родитель и категории верхнего уровня, куда можно перенести (§7). */
export function parentOptions(level: readonly CategoryNode[], node: CategoryNode): { value: string; label: string }[] {
  return [
    { value: 'top', label: 'Верхний уровень' },
    ...level
      .filter((p) => p.id === node.parentId || (p.id !== node.id && moveError(level, node, p.id) === null))
      .map((p) => ({ value: String(p.id), label: p.name })),
  ];
}

/** ↑ ↓ в окне категории: сдвиг среди видимых соседей вкладки (без архивных и без чужих системных); на краю и у архивной — null. */
export function categoryShiftPlan(tree: CategoryTree, tab: CategoryTab, id: number, delta: -1 | 1): MovePlan | null {
  const group = moveGroup(visibleRows(categoryRows(tree, tab), ''), id);
  const next = shiftInGroup(group, id, delta);
  return next ? categoryReorderPlan(tree, tab, next) : null;
}

/** Дерево с порядком из плана перестановки (оптимистичное обновление кэша); не названные — в конце. */
export function applyCategoryOrder(tree: CategoryTree, plan: MovePlan): CategoryTree {
  if (plan.parentId === null) return { ...tree, [plan.kind]: sortByIds(tree[plan.kind], plan.ids) };
  return {
    ...tree,
    [plan.kind]: tree[plan.kind].map((n) => (n.id === plan.parentId ? { ...n, children: sortByIds(n.children, plan.ids) } : n)),
  };
}
