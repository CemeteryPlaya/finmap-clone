import { COUNTERPARTY_TYPE_LABELS, COUNTERPARTY_TYPE_SINGULAR } from '../../shared/counterparties';
import { getCurrency, isKnownCurrency } from '../../shared/currencies';
import { SYSTEM_CATEGORIES, type CounterpartyType } from '../../shared/system-categories';
import type { PickerOption } from './picker';
import type { Account, CategoryNode, CategoryTree, Counterparty, Project, Tag } from './queries';

/**
 * Варианты выпадающих списков формы операции (§7): архивные не предлагаются (инвариант 7), но уже выбранный
 * архивный элемент остаётся в списке с пометкой «(в архиве)» — правка операции не теряет его.
 */
const ARCHIVED = ' (в архиве)';

type Archivable = { id: number; archivedAt: string | null };
const keep = (x: Archivable, selected: readonly (number | null)[]) => !x.archivedAt || selected.includes(x.id);
const mark = (label: string, x: Archivable) => (x.archivedAt ? label + ARCHIVED : label);

/** Бейдж системной категории в списках (§6.6 этапа 1.5) — тот же текст, что в журнале. */
export const SYSTEM_BADGE = 'системная';

/** Символ валюты для пункта; неизвестный код (справочник валют отстал от данных) — сам код, а не исключение. */
const currencySymbol = (code: string) => (isKnownCurrency(code) ? getCurrency(code).symbol : code);

/** Счета: название, символ валюты — справа в пункте (§6.6 этапа 1.5: «(KZT)» в названии нет). */
export function accountOptions(accounts: readonly Account[], selected: number | null): PickerOption[] {
  return accounts.filter((a) => keep(a, [selected])).map((a) => ({ id: a.id, label: mark(a.name, a), suffix: currencySymbol(a.currency) }));
}

/** Бейдж «системная» — у категории с собственным systemKey (у дочерних системной его нет, как в журнале). */
const withBadge = (option: PickerOption, node: Pick<CategoryNode, 'systemKey'>): PickerOption => (node.systemKey ? { ...option, badge: SYSTEM_BADGE } : option);

/** Категории вида kind: «Родитель», «Родитель → Дочерняя». Дочерняя архивного родителя тоже считается архивной. */
export function categoryOptions(tree: CategoryTree, kind: 'income' | 'expense', selected: readonly (number | null)[]): PickerOption[] {
  return tree[kind].flatMap((n) => [
    ...(keep(n, selected) ? [withBadge({ id: n.id, label: mark(n.name, n) }, n)] : []),
    ...n.children
      .map((c) => ({ ...c, archivedAt: c.archivedAt ?? n.archivedAt }))
      .filter((c) => keep(c, selected))
      .map((c) => withBadge({ id: c.id, label: mark(`${n.name} → ${c.name}`, c) }, c)),
  ]);
}

export function projectOptions(projects: readonly Project[], selected: readonly (number | null)[]): PickerOption[] {
  return projects.filter((p) => keep(p, selected)).map((p) => ({ id: p.id, label: mark(p.name, p) }));
}

export function tagOptions(tags: readonly Tag[], selected: readonly number[]): PickerOption[] {
  return tags.filter((t) => keep(t, selected)).map((t) => ({ id: t.id, label: mark(t.name, t) }));
}

/** Категория дерева по id (верхний уровень или дочерняя). */
export function findCategory(tree: CategoryTree, id: number | null): CategoryNode | undefined {
  if (id === null) return undefined;
  for (const n of [...tree.income, ...tree.expense]) {
    if (n.id === id) return n;
    const child = n.children.find((c) => c.id === id);
    if (child) return child;
  }
  return undefined;
}

/** Тип контрагента, который подходит категории с эффективным systemKey (§4.4): «Зарплата» → сотрудник. */
export function preferredCounterpartyType(tree: CategoryTree, categoryId: number | null): CounterpartyType | null {
  const key = findCategory(tree, categoryId)?.effectiveSystemKey;
  return SYSTEM_CATEGORIES.find((c) => c.key === key)?.counterpartyType ?? null;
}

/**
 * Подпись поля контрагента (§6.4 этапа 1.5): по системной категории операции — «Сотрудник», «Владелец», «Инвестор»,
 * «Кредитор», «Заёмщик», «Тип налога»; без системной категории — «Мой контрагент», как в Finmap.
 */
export function counterpartyLabel(tree: CategoryTree, categoryId: number | null): string {
  const preferred = preferredCounterpartyType(tree, categoryId);
  return preferred ? COUNTERPARTY_TYPE_SINGULAR[preferred] : 'Мой контрагент';
}

/**
 * Контрагенты: для категории с эффективным systemKey сначала подходящий тип («Сотрудники»), затем «Остальные» (§7).
 */
export function counterpartyOptions(counterparties: readonly Counterparty[], selected: number | null, preferred: CounterpartyType | null): PickerOption[] {
  const list = counterparties.filter((c) => keep(c, [selected])).map((c) => ({ id: c.id, label: mark(c.name, c), type: c.type }));
  if (!preferred) return list.map(({ id, label }) => ({ id, label }));
  return [
    ...list.filter((c) => c.type === preferred).map(({ id, label }) => ({ id, label, section: COUNTERPARTY_TYPE_LABELS[preferred] })),
    ...list.filter((c) => c.type !== preferred).map(({ id, label }) => ({ id, label, section: 'Остальные' })),
  ];
}
