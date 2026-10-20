import { describe, expect, it } from 'vitest';
import {
  accountOptions,
  categoryOptions,
  commonCounterpartyType,
  counterpartyLabel,
  counterpartyLabelOf,
  counterpartyOptions,
  findCategory,
  preferredCounterpartyType,
  projectOptions,
  salaryCategory,
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
    // символ валюты — справа в пункте (suffix), в названии «(KZT)» нет (§6.6 этапа 1.5)
    expect(accountOptions(accounts, null)).toEqual([{ id: 1, label: 'Касса', suffix: '₸' }]);
    expect(accountOptions(accounts, 2)).toEqual([
      { id: 1, label: 'Касса', suffix: '₸' },
      { id: 2, label: 'Старый (в архиве)', suffix: '$' },
    ]);
    // неизвестный код валюты — вместо символа сам код, без исключения
    expect(accountOptions([account(3, 'Странный', 'XYZ')], null)).toEqual([{ id: 3, label: 'Странный', suffix: 'XYZ' }]);
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

  it('категории: только вида операции, дочерние — «Родитель → Дочерняя»; дочерняя архивного родителя — архивная', () => {
    expect(categoryOptions(tree, 'income', [])).toEqual([{ id: 1, label: 'Выручка' }]);
    expect(categoryOptions(tree, 'expense', [null]).map((o) => o.label)).toEqual(['Зарплата', 'Зарплата → Администраторы', 'Помещение', 'Помещение → Аренда']);
    expect(categoryOptions(tree, 'expense', [31]).map((o) => o.label)).toContain('Старое → Дочерняя (в архиве)');
  });

  it('бейдж «системная» — только у категории с собственным systemKey, не у её дочерних (как в журнале)', () => {
    const options = categoryOptions(tree, 'expense', []);
    expect(options.find((o) => o.label === 'Зарплата')).toEqual({ id: 10, label: 'Зарплата', badge: 'системная' });
    expect(options.find((o) => o.label === 'Зарплата → Администраторы')).toEqual({ id: 11, label: 'Зарплата → Администраторы' });
    expect(options.find((o) => o.label === 'Помещение')).toEqual({ id: 20, label: 'Помещение' });
  });

  it('категория зарплаты — по эффективному systemKey, в том числе дочерняя', () => {
    expect(salaryCategory(tree, 10)?.name).toBe('Зарплата');
    expect(salaryCategory(tree, 11)?.name).toBe('Администраторы');
    expect(salaryCategory(tree, 21)).toBeUndefined();
    expect(salaryCategory(tree, null)).toBeUndefined();
  });

  it('подпись поля контрагента — по системной категории (§6.4 этапа 1.5)', () => {
    const system = (id: number, name: string, key: string): CategoryNode => node(id, name, { systemKey: key, effectiveSystemKey: key });
    const all: CategoryTree = {
      income: [system(101, 'Инвестиции', 'investment'), system(102, 'Возврат займа', 'loan_repaid'), system(103, 'Получение кредита', 'credit_received')],
      expense: [...tree.expense, system(104, 'Дивиденды', 'dividends'), system(105, 'Налоги', 'tax'), system(106, 'НДС', 'vat'), system(107, 'Погашение кредита', 'credit_repayment'), system(108, 'Выдача займа', 'loan_issued')],
    };
    expect(counterpartyLabel(all, null)).toBe('Мой контрагент');
    expect(counterpartyLabel(all, 21)).toBe('Мой контрагент');
    expect(counterpartyLabel(all, 10)).toBe('Сотрудник');
    expect(counterpartyLabel(all, 11)).toBe('Сотрудник');
    expect(counterpartyLabel(all, 104)).toBe('Владелец');
    expect(counterpartyLabel(all, 101)).toBe('Инвестор');
    expect(counterpartyLabel(all, 103)).toBe('Кредитор');
    expect(counterpartyLabel(all, 102)).toBe('Заёмщик');
    expect(counterpartyLabel(all, 105)).toBe('Тип налога');
    expect(counterpartyLabel(all, 106)).toBe('Тип налога');
    expect(counterpartyLabel(all, 107)).toBe('Кредитор');
    expect(counterpartyLabel(all, 108)).toBe('Заёмщик');
  });

  it('эффективный systemKey дочерней категории → подходящий тип контрагента; обычная категория — без предпочтения', () => {
    expect(findCategory(tree, 11)?.name).toBe('Администраторы');
    expect(findCategory(tree, 99)).toBeUndefined();
    expect(preferredCounterpartyType(tree, 10)).toBe('employee');
    expect(preferredCounterpartyType(tree, 11)).toBe('employee');
    expect(preferredCounterpartyType(tree, 21)).toBeNull();
    expect(preferredCounterpartyType(tree, null)).toBeNull();
  });

  const people = [cp(1, 'Поставщик А', 'supplier'), cp(2, 'Сотрудник А', 'employee'), cp(3, 'Сотрудник Б', 'employee', ARCH), cp(4, 'Сотрудник В', 'employee')];

  it('контрагенты системной категории: только закреплённый тип, выбранный другого типа остаётся', () => {
    expect(counterpartyOptions(people, null, 'employee', 'only')).toEqual([
      { id: 2, label: 'Сотрудник А' },
      { id: 4, label: 'Сотрудник В' },
    ]);
    // уже выбранный другого типа (старые данные, импорт) — в общем порядке списка, правка его не теряет
    expect(counterpartyOptions(people, 1, 'employee', 'only')).toEqual([
      { id: 1, label: 'Поставщик А' },
      { id: 2, label: 'Сотрудник А' },
      { id: 4, label: 'Сотрудник В' },
    ]);
    expect(counterpartyOptions(people, 3, 'employee', 'only')).toEqual([
      { id: 2, label: 'Сотрудник А' },
      { id: 3, label: 'Сотрудник Б (в архиве)' },
      { id: 4, label: 'Сотрудник В' },
    ]);
    // обычная категория — все неархивные, без заголовков
    expect(counterpartyOptions(people, null, null, 'only')).toEqual([
      { id: 1, label: 'Поставщик А' },
      { id: 2, label: 'Сотрудник А' },
      { id: 4, label: 'Сотрудник В' },
    ]);
  });

  it('режим first — прежние секции (документ склада)', () => {
    expect(counterpartyOptions(people, null, 'supplier', 'first')).toEqual([
      { id: 1, label: 'Поставщик А', section: 'Поставщики' },
      { id: 2, label: 'Сотрудник А', section: 'Остальные' },
      { id: 4, label: 'Сотрудник В', section: 'Остальные' },
    ]);
    expect(counterpartyOptions(people, null, null, 'first')).toEqual([
      { id: 1, label: 'Поставщик А' },
      { id: 2, label: 'Сотрудник А' },
      { id: 4, label: 'Сотрудник В' },
    ]);
  });

  it('общий тип строк разбиения: один тип у всех строк, иначе нет', () => {
    const system = (id: number, name: string, key: string): CategoryNode => node(id, name, { systemKey: key, effectiveSystemKey: key });
    const taxes: CategoryTree = { income: [], expense: [...tree.expense, system(105, 'Налоги', 'tax'), system(106, 'НДС', 'vat')] };
    expect(commonCounterpartyType(tree, [10, 11])).toBe('employee');
    expect(commonCounterpartyType(tree, [10, 21])).toBeNull();
    expect(commonCounterpartyType(tree, [10, null])).toBeNull();
    expect(commonCounterpartyType(tree, [21])).toBeNull();
    expect(commonCounterpartyType(tree, [])).toBeNull();
    // «Налоги» и «НДС» — один тип контрагента
    expect(commonCounterpartyType(taxes, [105, 106])).toBe('tax');
    expect(counterpartyLabelOf(null)).toBe('Мой контрагент');
    expect(counterpartyLabelOf('owner')).toBe('Владелец');
    expect(counterpartyLabelOf('employee')).toBe('Сотрудник');
  });
});
