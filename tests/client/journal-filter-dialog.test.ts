import { describe, expect, it } from 'vitest';
import { EMPTY_JOURNAL_STATE, pickDialogFields, type DialogFields } from '../../src/client/lib/journal-filter';
import { DIMENSIONS, dimensionOptions, dimensionSelected, toggleDimension, UNAVAILABLE, type FilterDialogData } from '../../src/client/lib/journal-filter-dialog';
import type { Account, CategoryNode, Counterparty, Project, Tag } from '../../src/client/lib/queries';

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
/** Строка справочника: функциям окна нужны только id, название и архив. */
const row = <T,>(id: number, name: string, archivedAt: string | null = null) => ({ id, name, archivedAt }) as unknown as T;

const data: FilterDialogData = {
  accounts: [row<Account>(1, 'Касса'), row<Account>(2, 'Старый', ARCH)],
  categories: {
    income: [node(10, 'Выручка', { kind: 'income' })],
    expense: [node(20, 'Помещение', { children: [node(21, 'Коммуналка', { parentId: 20 }), node(22, 'Свет', { parentId: 20, archivedAt: ARCH })] })],
  },
  projects: [row<Project>(5, 'Клуб 1')],
  counterparties: [row<Counterparty>(7, 'ИП Поставщик'), row<Counterparty>(8, 'Ушёл', ARCH)],
  tags: [row<Tag>(9, 'Смена')],
};
const empty: DialogFields = pickDialogFields(EMPTY_JOURNAL_STATE);

describe('окно «Фильтры» (§5.6 этапа 1.5)', () => {
  it('поля в порядке Finmap', () => {
    expect(DIMENSIONS.map((d) => [d.label, d.allLabel])).toEqual([
      ['Типы платежей и категории', 'Все типы платежей и категорий'],
      ['Контрагенты', 'Все контрагенты'],
      ['Проекты', 'Все проекты'],
      ['Теги', 'Все теги'],
      ['Счета', 'Все счета'],
    ]);
  });

  it('снятый архивный пункт пропадает из списка, пока он отмечен — виден', () => {
    const selected = { ...empty, categoryIds: [22] };
    expect(dimensionOptions('typesCategories', data, selected).some((o) => o.key === 'category:22')).toBe(true);
    const cleared = toggleDimension('typesCategories', selected, 'category:22');
    expect(dimensionOptions('typesCategories', data, cleared).some((o) => o.key === 'category:22')).toBe(false);
  });

  it('«Типы платежей и категории»: группа «Тип», категории дохода и расхода деревом, «Без категории»; архивные — только выбранные', () => {
    expect(dimensionOptions('typesCategories', data, empty)).toEqual([
      { key: 'type:income', label: 'Доход', section: 'Тип' },
      { key: 'type:expense', label: 'Расход', section: 'Тип' },
      { key: 'type:transfer', label: 'Перевод', section: 'Тип' },
      { key: 'category:10', label: 'Выручка', section: 'Категории дохода' },
      { key: 'category:20', label: 'Помещение', section: 'Категории расхода' },
      { key: 'category:21', label: 'Коммуналка', section: 'Категории расхода', nested: true },
      { key: 'none', label: 'Без категории' },
    ]);
    expect(dimensionOptions('typesCategories', data, { ...empty, categoryIds: [22] })).toContainEqual({
      key: 'category:22',
      label: 'Свет (архив)',
      section: 'Категории расхода',
      nested: true,
    });
  });

  it('«Без контрагента» и «Без проекта» — первыми; архивные — только выбранные; неизвестный id — «Недоступный элемент» (Review Focus 5)', () => {
    expect(dimensionOptions('counterparties', data, empty)).toEqual([
      { key: 'none', label: 'Без контрагента' },
      { key: '7', label: 'ИП Поставщик' },
    ]);
    expect(dimensionOptions('counterparties', data, { ...empty, counterpartyIds: [8, 99] })).toEqual([
      { key: 'none', label: 'Без контрагента' },
      { key: '7', label: 'ИП Поставщик' },
      { key: '8', label: 'Ушёл (архив)' },
      { key: '99', label: UNAVAILABLE },
    ]);
    expect(dimensionOptions('projects', data, { ...empty, projectIds: [999999] })).toEqual([
      { key: 'none', label: 'Без проекта' },
      { key: '5', label: 'Клуб 1' },
      { key: '999999', label: 'Недоступный элемент' },
    ]);
    expect(dimensionOptions('typesCategories', data, { ...empty, categoryIds: [77] })).toContainEqual({ key: 'category:77', label: 'Недоступный элемент' });
    expect(dimensionOptions('tags', data, empty)).toEqual([{ key: '9', label: 'Смена' }]);
    expect(dimensionOptions('accounts', data, empty)).toEqual([{ key: '1', label: 'Касса' }]);
  });

  it('выбранное и переключение: тип и категория раздельно, «без …» — флагом; id по возрастанию; недоступный снимается', () => {
    let d = toggleDimension('typesCategories', empty, 'type:expense');
    d = toggleDimension('typesCategories', d, 'category:20');
    d = toggleDimension('typesCategories', d, 'none');
    expect(d).toMatchObject({ types: ['expense'], categoryIds: [20], withoutCategory: true });
    expect(dimensionSelected('typesCategories', d)).toEqual(['type:expense', 'category:20', 'none']);
    d = toggleDimension('typesCategories', d, 'type:income');
    expect(d.types).toEqual(['income', 'expense']);
    d = toggleDimension('typesCategories', d, 'type:expense');
    expect(d.types).toEqual(['income']);
    d = toggleDimension('counterparties', d, 'none');
    expect(d.withoutCounterparty).toBe(true);
    expect(dimensionSelected('counterparties', d)).toEqual(['none']);
    d = toggleDimension('projects', d, '6');
    d = toggleDimension('projects', d, '5');
    expect(d.projectIds).toEqual([5, 6]);
    d = toggleDimension('projects', d, '6');
    expect(dimensionSelected('projects', d)).toEqual(['5']);
    d = toggleDimension('tags', d, '9');
    d = toggleDimension('accounts', d, '1');
    expect([dimensionSelected('tags', d), dimensionSelected('accounts', d)]).toEqual([['9'], ['1']]);
    expect(toggleDimension('projects', { ...empty, projectIds: [999999] }, '999999').projectIds).toEqual([]);
  });
});
