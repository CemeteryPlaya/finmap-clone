import { describe, expect, it } from 'vitest';
import {
  accountOptions,
  categoryOptions,
  counterpartyOptions,
  findCategory,
  preferredCounterpartyType,
  projectOptions,
  tagOptions,
} from '../../src/client/lib/operation-options';
import type { Account, CategoryNode, CategoryTree, Counterparty, Project, Tag } from '../../src/client/lib/queries';

const ARCH = '2026-10-01T00:00:00.000Z';

const node = (id: number, name: string, patch: Partial<CategoryNode> = {}): CategoryNode => ({
  id,
  companyId: 1,
  kind: 'expense',
  parentId: null,
  name,
  systemKey: null,
  effectiveSystemKey: null,
  templateRef: null,
  orderIndex: 0,
  archivedAt: null,
  children: [],
  ...patch,
});

const tree: CategoryTree = {
  income: [node(1, 'Выручка', { kind: 'income' })],
  expense: [
    node(10, 'Зарплата', {
      systemKey: 'salary',
      effectiveSystemKey: 'salary',
      children: [node(11, 'Администраторы', { parentId: 10, effectiveSystemKey: 'salary' })],
    }),
    node(20, 'Помещение', { children: [node(21, 'Аренда', { parentId: 20 }), node(22, 'Свет', { parentId: 20, archivedAt: ARCH })] }),
    node(30, 'Старое', { archivedAt: ARCH, children: [node(31, 'Дочерняя', { parentId: 30 })] }),
  ],
};

const account = (id: number, name: string, currency: string, archivedAt: string | null = null) =>
  ({ id, name, currency, archivedAt }) as Account;
const cp = (id: number, name: string, type: Counterparty['type'], archivedAt: string | null = null) => ({ id, name, type, archivedAt }) as Counterparty;

describe('варианты списков формы операции', () => {
  it('архивные не предлагаются, уже выбранный архивный остаётся с пометкой', () => {
    const accounts = [account(1, 'Касса', 'KZT'), account(2, 'Старый', 'USD', ARCH)];
    expect(accountOptions(accounts, null)).toEqual([{ id: 1, label: 'Касса (KZT)' }]);
    expect(accountOptions(accounts, 2)).toEqual([
      { id: 1, label: 'Касса (KZT)' },
      { id: 2, label: 'Старый (USD) (в архиве)' },
    ]);
    const projects = [{ id: 5, name: 'Клуб', archivedAt: null }, { id: 6, name: 'Закрытый', archivedAt: ARCH }] as Project[];
    expect(projectOptions(projects, [null])).toEqual([{ id: 5, label: 'Клуб' }]);
    expect(projectOptions(projects, [6])).toHaveLength(2);
    const tags = [{ id: 7, name: 'нал', archivedAt: null }, { id: 8, name: 'старый', archivedAt: ARCH }] as Tag[];
    expect(tagOptions(tags, [])).toEqual([{ id: 7, label: 'нал' }]);
    expect(tagOptions(tags, [8])).toEqual([
      { id: 7, label: 'нал' },
      { id: 8, label: 'старый (в архиве)' },
    ]);
  });

  it('статьи: только вида операции, дочерние — «Родитель → Дочерняя»; дочерняя архивного родителя — архивная', () => {
    expect(categoryOptions(tree, 'income', [])).toEqual([{ id: 1, label: 'Выручка' }]);
    expect(categoryOptions(tree, 'expense', [null]).map((o) => o.label)).toEqual(['Зарплата', 'Зарплата → Администраторы', 'Помещение', 'Помещение → Аренда']);
    expect(categoryOptions(tree, 'expense', [31]).map((o) => o.label)).toContain('Старое → Дочерняя (в архиве)');
  });

  it('эффективный systemKey дочерней статьи → подходящий тип контрагента; обычная статья — без предпочтения', () => {
    expect(findCategory(tree, 11)?.name).toBe('Администраторы');
    expect(findCategory(tree, 99)).toBeUndefined();
    expect(preferredCounterpartyType(tree, 10)).toBe('employee');
    expect(preferredCounterpartyType(tree, 11)).toBe('employee');
    expect(preferredCounterpartyType(tree, 21)).toBeNull();
    expect(preferredCounterpartyType(tree, null)).toBeNull();
  });

  it('контрагенты: подходящий тип первым с заголовком группы, остальные — после', () => {
    const list = [cp(1, 'ТОО Свет', 'supplier'), cp(2, 'Айгерим', 'employee'), cp(3, 'Уволен', 'employee', ARCH), cp(4, 'Бауыржан', 'employee')];
    expect(counterpartyOptions(list, null, null)).toEqual([
      { id: 1, label: 'ТОО Свет' },
      { id: 2, label: 'Айгерим' },
      { id: 4, label: 'Бауыржан' },
    ]);
    expect(counterpartyOptions(list, null, 'employee')).toEqual([
      { id: 2, label: 'Айгерим', section: 'Сотрудники' },
      { id: 4, label: 'Бауыржан', section: 'Сотрудники' },
      { id: 1, label: 'ТОО Свет', section: 'Остальные' },
    ]);
  });
});
