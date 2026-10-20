import type { CounterpartyType } from '../../shared/system-categories';
import { categoryOptions, counterpartyLabel, counterpartyOptions, preferredCounterpartyType, projectOptions } from './operation-options';
import type { CreatableKind } from './operation-create';
import type { PickerOption } from './picker';
import type { CategoryTree, Counterparty, JournalItem, Project } from './queries';

/** Поле, которое можно «Указать» в пустой ячейке журнала (§7). */
export type AssignField = 'counterparty' | 'category' | 'project';

export const ASSIGN_LABELS: Record<AssignField, string> = {
  counterparty: 'Указать контрагента',
  category: 'Указать категорию',
  project: 'Указать проект',
};

export type AssignTarget = Pick<JournalItem, 'type' | 'version' | 'amount' | 'baseAmount' | 'counterpartyId' | 'lines'>;

/**
 * «Указать» есть только в пустой ячейке операции с одной строкой; проект — ещё у перевода без строк (§7).
 * У перевода нет контрагента и категории.
 */
export function canAssign(item: AssignTarget, field: AssignField): boolean {
  const single = item.lines.length === 1 ? item.lines[0]! : null;
  switch (field) {
    case 'counterparty':
      return item.type !== 'transfer' && item.counterpartyId === null && single !== null;
    case 'category':
      return item.type !== 'transfer' && single !== null && single.categoryId === null;
    case 'project':
      return (single !== null && single.projectId === null) || (item.type === 'transfer' && item.lines.length === 0);
  }
}

export interface AssignPatch {
  version: number;
  counterpartyId?: number;
  lines?: { categoryId: number | null; projectId: number | null; amount: number }[];
}

/**
 * Тело PATCH /operations/:id для «Указать»: версия, которую видел пользователь (при конфликте — 409),
 * и одно поле — контрагент или строки из одной строки (план 5a, решение 9).
 */
export function assignPatch(item: AssignTarget, field: AssignField, id: number): AssignPatch {
  if (field === 'counterparty') return { version: item.version, counterpartyId: id };
  const line = item.lines[0];
  return {
    version: item.version,
    lines: [
      {
        categoryId: field === 'category' ? id : (line?.categoryId ?? null),
        projectId: field === 'project' ? id : (line?.projectId ?? null),
        amount: line?.amount ?? item.amount,
      },
    ],
  };
}

/** Операция с указанным значением — для оптимистичного показа до ответа сервера. */
export function withAssigned<T extends AssignTarget>(item: T, field: AssignField, id: number): T {
  if (field === 'counterparty') return { ...item, counterpartyId: id };
  const line = item.lines[0] ?? { id: 0, position: 0, categoryId: null, projectId: null, amount: item.amount, baseAmount: item.baseAmount };
  return { ...item, lines: [{ ...line, ...(field === 'category' ? { categoryId: id } : { projectId: id }) }] };
}

/** Справочники для «Указать» и «Изменить данные». */
export interface AssignData {
  categories: CategoryTree;
  projects: Project[];
  counterparties: Counterparty[];
}

/** Заголовок окна «Указать» (§5.4 этапа 1.5). */
export const ASSIGN_TITLES: Record<AssignField, string> = {
  counterparty: 'Редактирование контрагента',
  category: 'Редактирование категории',
  project: 'Редактирование проекта',
};

/** Название списка для программ чтения с экрана. */
export const ASSIGN_LIST_LABELS: Record<AssignField, string> = {
  counterparty: 'Контрагенты',
  category: 'Категории',
  project: 'Проекты',
};

/** Категория операции с одной строкой — по ней подбирается тип контрагента (§6.4); у разбитой и без строк — null. */
function singleCategory(item: Pick<AssignTarget, 'lines'>): number | null {
  return item.lines.length === 1 ? item.lines[0]!.categoryId : null;
}

/** Подпись поля в окне «Указать»: у контрагента — по системной категории операции («Сотрудник»), иначе «Мой контрагент». */
export function assignLabel(item: AssignTarget, field: AssignField, tree: CategoryTree): string {
  if (field === 'category') return 'Категория';
  if (field === 'project') return 'Проект';
  return counterpartyLabel(tree, singleCategory(item));
}

/**
 * Варианты списка «Указать» — те же правила, что в форме операции: архивные не предлагаются (инвариант 7),
 * категории — только вида операции (инвариант 3), у системной категории — только контрагенты её типа.
 */
export function assignOptions(item: AssignTarget, field: AssignField, data: AssignData): PickerOption[] {
  if (field === 'counterparty') return counterpartyOptions(data.counterparties, null, preferredCounterpartyType(data.categories, singleCategory(item)), 'only');
  if (field === 'project') return projectOptions(data.projects, []);
  return item.type === 'transfer' ? [] : categoryOptions(data.categories, item.type, []);
}

/** Что создаёт «+ Создать» в окне «Указать» (§5.4, §6.6 этапа 1.5). */
export const ASSIGN_CREATE_NOUNS: Record<AssignField, string> = {
  counterparty: 'контрагента',
  category: 'категорию',
  project: 'проект',
};

/**
 * «+ Создать» в окне «Указать» — те же правила, что в форме (план 6a): категория — верхнего уровня вида операции,
 * контрагент — типа под системную категорию операции, иначе «Клиент» у дохода и «Поставщик» у расхода.
 */
export function assignCreate(item: AssignTarget, field: AssignField, tree: CategoryTree): { what: CreatableKind; kind: 'income' | 'expense'; counterpartyType: CounterpartyType } {
  const kind = item.type === 'income' ? 'income' : 'expense';
  const counterpartyType = preferredCounterpartyType(tree, singleCategory(item)) ?? (kind === 'income' ? 'client' : 'supplier');
  return { what: field, kind, counterpartyType };
}
