import { COUNTERPARTY_TYPE_LABELS } from '../../shared/counterparties';
import { SYSTEM_CATEGORIES, type CounterpartyType } from '../../shared/system-categories';
import type { PickerOption } from '../components/SearchPicker';
import type { Account, CategoryNode, CategoryTree, Counterparty, Project, Tag } from './queries';

/**
 * Варианты выпадающих списков формы операции (§7): архивные не предлагаются (инвариант 7), но уже выбранный
 * архивный элемент остаётся в списке с пометкой «(в архиве)» — правка операции не теряет его.
 */
const ARCHIVED = ' (в архиве)';

type Archivable = { id: number; archivedAt: string | null };
const keep = (x: Archivable, selected: readonly (number | null)[]) => !x.archivedAt || selected.includes(x.id);
const mark = (label: string, x: Archivable) => (x.archivedAt ? label + ARCHIVED : label);

export function accountOptions(accounts: readonly Account[], selected: number | null): PickerOption[] {
  return accounts.filter((a) => keep(a, [selected])).map((a) => ({ id: a.id, label: mark(`${a.name} (${a.currency})`, a) }));
}

/** Статьи вида kind: «Родитель», «Родитель → Дочерняя». Дочерняя архивного родителя тоже считается архивной. */
export function categoryOptions(tree: CategoryTree, kind: 'income' | 'expense', selected: readonly (number | null)[]): PickerOption[] {
  return tree[kind].flatMap((n) => [
    ...(keep(n, selected) ? [{ id: n.id, label: mark(n.name, n) }] : []),
    ...n.children
      .map((c) => ({ ...c, archivedAt: c.archivedAt ?? n.archivedAt }))
      .filter((c) => keep(c, selected))
      .map((c) => ({ id: c.id, label: mark(`${n.name} → ${c.name}`, c) })),
  ]);
}

export function projectOptions(projects: readonly Project[], selected: readonly (number | null)[]): PickerOption[] {
  return projects.filter((p) => keep(p, selected)).map((p) => ({ id: p.id, label: mark(p.name, p) }));
}

export function tagOptions(tags: readonly Tag[], selected: readonly number[]): PickerOption[] {
  return tags.filter((t) => keep(t, selected)).map((t) => ({ id: t.id, label: mark(t.name, t) }));
}

/** Статья дерева по id (верхний уровень или дочерняя). */
export function findCategory(tree: CategoryTree, id: number | null): CategoryNode | undefined {
  if (id === null) return undefined;
  for (const n of [...tree.income, ...tree.expense]) {
    if (n.id === id) return n;
    const child = n.children.find((c) => c.id === id);
    if (child) return child;
  }
  return undefined;
}

/** Тип контрагента, который подходит статье с эффективным systemKey (§4.4): «Зарплата» → сотрудник. */
export function preferredCounterpartyType(tree: CategoryTree, categoryId: number | null): CounterpartyType | null {
  const key = findCategory(tree, categoryId)?.effectiveSystemKey;
  return SYSTEM_CATEGORIES.find((c) => c.key === key)?.counterpartyType ?? null;
}

/**
 * Контрагенты: для статьи с эффективным systemKey сначала подходящий тип («Сотрудники»), затем «Остальные» (§7).
 */
export function counterpartyOptions(counterparties: readonly Counterparty[], selected: number | null, preferred: CounterpartyType | null): PickerOption[] {
  const list = counterparties.filter((c) => keep(c, [selected])).map((c) => ({ id: c.id, label: mark(c.name, c), type: c.type }));
  if (!preferred) return list.map(({ id, label }) => ({ id, label }));
  return [
    ...list.filter((c) => c.type === preferred).map(({ id, label }) => ({ id, label, section: COUNTERPARTY_TYPE_LABELS[preferred] })),
    ...list.filter((c) => c.type !== preferred).map(({ id, label }) => ({ id, label, section: 'Остальные' })),
  ];
}
