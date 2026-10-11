import { OPERATION_TYPES, sortedUnique, type DialogFields, type OperationType } from './journal-filter';
import type { Account, CategoryNode, CategoryTree, Counterparty, Project, Tag } from './queries';

/** Справочники окна «Фильтры». */
export interface FilterDialogData {
  accounts: Account[];
  categories: CategoryTree;
  projects: Project[];
  counterparties: Counterparty[];
  tags: Tag[];
}

/** Пункт выпадающего мультивыбора (§5.6 этапа 1.5): ключ, подпись, группа и отступ дочерней категории. */
export interface MultiOption {
  key: string;
  label: string;
  section?: string;
  nested?: boolean;
}

export type FilterDimension = 'typesCategories' | 'counterparties' | 'projects' | 'tags' | 'accounts';

/** Поля окна в порядке Finmap: подпись (со счётчиком выбранного) и значение, когда ничего не выбрано. */
export const DIMENSIONS: readonly { dim: FilterDimension; label: string; allLabel: string }[] = [
  { dim: 'typesCategories', label: 'Типы платежей и категории', allLabel: 'Все типы и категории' },
  { dim: 'counterparties', label: 'Контрагенты', allLabel: 'Все контрагенты' },
  { dim: 'projects', label: 'Проекты', allLabel: 'Все проекты' },
  { dim: 'tags', label: 'Теги', allLabel: 'Все теги' },
  { dim: 'accounts', label: 'Счета', allLabel: 'Все счета' },
];

/** Подпись id из адреса, которого нет в справочниках (удалён или из другой компании, 5b №5): его можно снять. */
export const UNAVAILABLE = 'Недоступный элемент';

/** Ключ «без значения»: «Без категории», «Без контрагента», «Без проекта». */
const NONE = 'none';
const TYPE_PREFIX = 'type:';
const CATEGORY_PREFIX = 'category:';
const TYPE_LABELS: Record<OperationType, string> = { income: 'Доход', expense: 'Расход', transfer: 'Перевод' };

type Row = { id: number; name: string; archivedAt: string | null };

/** Архивные не предлагаются — кроме уже выбранных (их можно снять); выбранные id без строки — «Недоступный элемент». */
function rowOptions(rows: readonly Row[], selected: readonly number[]): MultiOption[] {
  const known = new Set(rows.map((r) => r.id));
  return [
    ...rows.filter((r) => !r.archivedAt || selected.includes(r.id)).map((r) => ({ key: String(r.id), label: r.archivedAt ? `${r.name} (архив)` : r.name })),
    ...selected.filter((id) => !known.has(id)).map((id) => ({ key: String(id), label: UNAVAILABLE })),
  ];
}

/** Категории вида деревом: дочерняя — с отступом; дочерняя архивного родителя тоже считается архивной. */
function categoryRows(nodes: readonly CategoryNode[], selected: readonly number[], section: string): MultiOption[] {
  return nodes.flatMap((n) => {
    const self = !n.archivedAt || selected.includes(n.id) ? [{ key: `${CATEGORY_PREFIX}${n.id}`, label: n.archivedAt ? `${n.name} (архив)` : n.name, section }] : [];
    const children = n.children
      .filter((c) => (!c.archivedAt && !n.archivedAt) || selected.includes(c.id))
      .map((c) => ({ key: `${CATEGORY_PREFIX}${c.id}`, label: c.archivedAt || n.archivedAt ? `${c.name} (архив)` : c.name, section, nested: true }));
    return [...self, ...children];
  });
}

/** Пункты поля окна «Фильтры» (§5.6). */
export function dimensionOptions(dim: FilterDimension, data: FilterDialogData, draft: DialogFields): MultiOption[] {
  switch (dim) {
    case 'typesCategories': {
      const all = [...data.categories.income, ...data.categories.expense];
      const known = new Set(all.flatMap((n) => [n.id, ...n.children.map((c) => c.id)]));
      return [
        ...OPERATION_TYPES.map((t) => ({ key: `${TYPE_PREFIX}${t}`, label: TYPE_LABELS[t], section: 'Тип' })),
        ...categoryRows(data.categories.income, draft.categoryIds, 'Категории дохода'),
        ...categoryRows(data.categories.expense, draft.categoryIds, 'Категории расхода'),
        ...draft.categoryIds.filter((id) => !known.has(id)).map((id) => ({ key: `${CATEGORY_PREFIX}${id}`, label: UNAVAILABLE })),
        { key: NONE, label: 'Без категории' },
      ];
    }
    case 'counterparties':
      return [{ key: NONE, label: 'Без контрагента' }, ...rowOptions(data.counterparties, draft.counterpartyIds)];
    case 'projects':
      return [{ key: NONE, label: 'Без проекта' }, ...rowOptions(data.projects, draft.projectIds)];
    case 'tags':
      return rowOptions(data.tags, draft.tagIds);
    case 'accounts':
      return rowOptions(data.accounts, draft.accountIds);
  }
}

/** Ключи отмеченных пунктов поля. */
export function dimensionSelected(dim: FilterDimension, draft: DialogFields): string[] {
  switch (dim) {
    case 'typesCategories':
      return [...draft.types.map((t) => `${TYPE_PREFIX}${t}`), ...draft.categoryIds.map((id) => `${CATEGORY_PREFIX}${id}`), ...(draft.withoutCategory ? [NONE] : [])];
    case 'counterparties':
      return [...(draft.withoutCounterparty ? [NONE] : []), ...draft.counterpartyIds.map(String)];
    case 'projects':
      return [...(draft.withoutProject ? [NONE] : []), ...draft.projectIds.map(String)];
    case 'tags':
      return draft.tagIds.map(String);
    case 'accounts':
      return draft.accountIds.map(String);
  }
}

const toggleId = (ids: readonly number[], id: number) => (ids.includes(id) ? ids.filter((x) => x !== id) : sortedUnique([...ids, id]));

/** Отметить или снять пункт поля: черновик окна с изменённым условием (адрес и смысл фильтра прежние). */
export function toggleDimension(dim: FilterDimension, draft: DialogFields, key: string): DialogFields {
  switch (dim) {
    case 'typesCategories': {
      if (key === NONE) return { ...draft, withoutCategory: !draft.withoutCategory };
      if (key.startsWith(TYPE_PREFIX)) {
        const t = key.slice(TYPE_PREFIX.length) as OperationType;
        return { ...draft, types: OPERATION_TYPES.filter((x) => (x === t ? !draft.types.includes(t) : draft.types.includes(x))) };
      }
      return { ...draft, categoryIds: toggleId(draft.categoryIds, Number(key.slice(CATEGORY_PREFIX.length))) };
    }
    case 'counterparties':
      return key === NONE ? { ...draft, withoutCounterparty: !draft.withoutCounterparty } : { ...draft, counterpartyIds: toggleId(draft.counterpartyIds, Number(key)) };
    case 'projects':
      return key === NONE ? { ...draft, withoutProject: !draft.withoutProject } : { ...draft, projectIds: toggleId(draft.projectIds, Number(key)) };
    case 'tags':
      return { ...draft, tagIds: toggleId(draft.tagIds, Number(key)) };
    case 'accounts':
      return { ...draft, accountIds: toggleId(draft.accountIds, Number(key)) };
  }
}
