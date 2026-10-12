import { describe, expect, it } from 'vitest';
import { matchDictionaries, neededCounterpartyType, pickCounterpartyType, type Dictionaries } from '../../src/server/modules/imports/match';
import type { ImportRow } from '../../src/server/modules/imports/parse-row';

/** Справочники компании: системные «Зарплата» и «Инвестиции», шаблонные дочерние, архивные. */
const DICTS: Dictionaries = {
  categories: [
    { id: 1, kind: 'expense', parentId: null, name: 'Зарплата', systemKey: 'salary', archivedAt: null },
    { id: 2, kind: 'expense', parentId: 1, name: 'Администраторы', systemKey: null, archivedAt: null },
    { id: 3, kind: 'income', parentId: null, name: 'Инвестиции', systemKey: 'investment', archivedAt: null },
    { id: 4, kind: 'expense', parentId: null, name: 'Аренда', systemKey: null, archivedAt: null },
    { id: 5, kind: 'expense', parentId: null, name: 'аренда', systemKey: null, archivedAt: null },
    { id: 6, kind: 'expense', parentId: null, name: 'Реклама', systemKey: null, archivedAt: '2026-10-01T00:00:00.000Z' },
    { id: 7, kind: 'expense', parentId: 4, name: 'Зал', systemKey: null, archivedAt: null },
    { id: 8, kind: 'expense', parentId: 4, name: 'Склад', systemKey: null, archivedAt: '2026-10-01T00:00:00.000Z' },
    { id: 9, kind: 'income', parentId: null, name: 'Бар', systemKey: null, archivedAt: null },
    { id: 10, kind: 'expense', parentId: 4, name: 'Охрана', systemKey: null, archivedAt: null },
    { id: 11, kind: 'income', parentId: 9, name: 'Охрана', systemKey: null, archivedAt: null },
  ],
  counterparties: [
    { id: 1, type: 'supplier', name: 'ИП Свет', archivedAt: null },
    { id: 2, type: 'client', name: 'ИП Свет', archivedAt: null },
    { id: 3, type: 'employee', name: 'Сотрудник А', archivedAt: null },
    { id: 4, type: 'client', name: 'Старый клиент', archivedAt: '2026-10-01T00:00:00.000Z' },
  ],
  projects: [
    { id: 1, name: 'Клуб 1', archivedAt: null },
    { id: 2, name: 'Клуб 2', archivedAt: '2026-10-01T00:00:00.000Z' },
  ],
  tags: [
    { id: 1, name: 'Смена', archivedAt: null },
    { id: 2, name: 'Старый', archivedAt: '2026-10-01T00:00:00.000Z' },
  ],
};

let n = 1;
/** Строка импорта: расход «Касса» по умолчанию. */
function r(v: Partial<ImportRow>): ImportRow {
  n++;
  return {
    row: n,
    type: 'expense',
    paidAt: '2026-10-05T05:00:00.000Z',
    date: '2026-10-05',
    minute: '2026-10-05 10:00',
    accrualDate: null,
    amount: '100',
    baseAmount: null,
    account: { key: 'касса', name: 'Касса' },
    toAccount: null,
    category: null,
    subcategory: null,
    counterparty: null,
    project: null,
    tags: [],
    comment: null,
    ...v,
  };
}

describe('сопоставление справочников (§4.5–§4.8 спецификации импорта)', () => {
  it('категории: верхний уровень, единственная дочерняя, системная по названию и виду, системное название с чужим видом — новая', () => {
    const rows = [
      r({ category: 'аренда' }), // две «Аренды» верхнего уровня — первая по порядку
      r({ category: 'Администраторы' }), // нет на верхнем уровне, одна дочерняя — она
      r({ category: 'ЗАРПЛАТА' }),
      r({ type: 'income', category: 'Зарплата' }),
      r({ category: 'Охрана' }), // две дочерние (у «Аренды» и у «Бара» другого вида) — у расхода одна
      r({ category: '\u004Bомиссия' }), // новая; латинская K — название чинится
    ];
    const m = matchDictionaries(DICTS, rows);
    expect(rows.map((x) => m.rows.get(x.row)!.category)).toEqual([{ id: 4 }, { id: 2 }, { id: 1 }, { key: 'income|зарплата' }, { id: 10 }, { key: 'expense|комиссия' }]);
    expect(rows.map((x) => m.rows.get(x.row)!.categorySystemKey)).toEqual([null, 'salary', 'salary', null, null, null]);
    expect(m.categories).toEqual([
      { key: 'income|зарплата', kind: 'income', name: 'Зарплата', parent: null, parentName: null, rows: 1 },
      { key: 'expense|комиссия', kind: 'expense', name: 'Комиссия', parent: null, parentName: null, rows: 1 },
    ]);
  });

  it('подкатегория: у существующего родителя — его ребёнок или новый; у нового родителя — новые оба; системный родитель', () => {
    const rows = [
      r({ category: 'Аренда', subcategory: 'зал' }),
      r({ category: 'Аренда', subcategory: 'Офис' }),
      r({ category: 'Зарплата', subcategory: 'Бармены' }),
      r({ category: 'Связь', subcategory: 'Интернет' }),
      r({ category: 'связь', subcategory: 'Телефон' }),
    ];
    const m = matchDictionaries(DICTS, rows);
    expect(rows.map((x) => m.rows.get(x.row)!.category)).toEqual([
      { id: 7 },
      { key: 'expense|id:4|офис' },
      { key: 'expense|id:1|бармены' },
      { key: 'expense|new:expense|связь|интернет' },
      { key: 'expense|new:expense|связь|телефон' },
    ]);
    expect(m.rows.get(rows[2]!.row)!.categorySystemKey).toBe('salary');
    // сначала верхний уровень, затем подкатегории — порядок создания
    expect(m.categories.map((c) => [c.name, c.parentName, c.parent])).toEqual([
      ['Связь', null, null],
      ['Офис', 'Аренда', { id: 4 }],
      ['Бармены', 'Зарплата', { id: 1 }],
      ['Интернет', 'Связь', { key: 'expense|связь' }],
      ['Телефон', 'Связь', { key: 'expense|связь' }],
    ]);
    expect(m.categories[0]!.rows).toBe(2);
  });

  it('архивные: категория, подкатегория, контрагент, проект, тег — R17 один текст на название; строка не сопоставлена', () => {
    const rows = [
      r({ category: 'Реклама' }),
      r({ category: 'Аренда', subcategory: 'Склад' }),
      r({ counterparty: 'Старый клиент' }),
      r({ project: 'клуб 2' }),
      r({ tags: ['Смена', 'старый'] }),
      r({ category: 'Реклама' }),
    ];
    const m = matchDictionaries(DICTS, rows);
    expect(m.issues.map((i) => `${i.row}: ${i.message}`)).toEqual([
      `${rows[0]!.row}: Категория «Реклама» в архиве — верните из архива`,
      `${rows[1]!.row}: Категория «Склад» в архиве — верните из архива`,
      `${rows[2]!.row}: Контрагент «Старый клиент» в архиве — верните из архива`,
      `${rows[3]!.row}: Проект «клуб 2» в архиве — верните из архива`,
      `${rows[4]!.row}: Тег «старый» в архиве — верните из архива`,
      `${rows[5]!.row}: Категория «Реклама» в архиве — верните из архива`,
    ]);
    expect(rows.every((x) => !m.rows.has(x.row))).toBe(true);
    expect(m.categories).toEqual([]);
  });

  it('контрагенты: тип по категории (Зарплата — сотрудник), существующий — сначала с нужным типом, затем любой; новый — самый частый тип', () => {
    const rows = [
      r({ category: 'Администраторы', counterparty: 'Сотрудник Б' }),
      r({ type: 'income', counterparty: 'ип свет' }),
      r({ counterparty: 'ИП Свет' }),
      r({ type: 'income', counterparty: 'Сотрудник А' }),
      r({ type: 'income', counterparty: 'Новый' }),
      r({ type: 'income', counterparty: 'новый' }),
      r({ counterparty: 'Новый' }),
      r({ type: 'income', category: 'Инвестиции', counterparty: 'Ровно' }),
      r({ type: 'income', counterparty: 'Ровно' }),
    ];
    const m = matchDictionaries(DICTS, rows);
    expect(rows.slice(1, 4).map((x) => m.rows.get(x.row)!.counterparty)).toEqual([{ id: 2 }, { id: 1 }, { id: 3 }]);
    expect(m.counterparties).toEqual([
      { key: 'сотрудник б', name: 'Сотрудник Б', type: 'employee', rows: 1 },
      { key: 'новый', name: 'Новый', type: 'client', rows: 3 },
      { key: 'ровно', name: 'Ровно', type: 'investor', rows: 2 },
    ]);
    expect(neededCounterpartyType('expense', 'tax')).toBe('tax');
    expect(neededCounterpartyType('expense', null)).toBe('supplier');
    expect(pickCounterpartyType(new Map([['supplier', 2], ['client', 2]]))).toBe('client');
  });

  it('проекты и теги: по ключу без учёта регистра и двойников; новые — по первому написанию; у перевода — только проект', () => {
    const rows = [
      r({ project: 'КЛУБ 1', tags: ['смена', 'Ночь'] }),
      r({ project: 'Клуб 3', tags: ['ночь'] }),
      r({ type: 'transfer', toAccount: { key: 'банк', name: 'Банк' }, project: 'клуб 3' }),
    ];
    const m = matchDictionaries(DICTS, rows);
    expect(rows.map((x) => [m.rows.get(x.row)!.project, m.rows.get(x.row)!.tags])).toEqual([
      [{ id: 1 }, [{ id: 1 }, { key: 'ночь' }]],
      [{ key: 'клуб 3' }, [{ key: 'ночь' }]],
      [{ key: 'клуб 3' }, []],
    ]);
    expect(m.projects).toEqual([{ key: 'клуб 3', name: 'Клуб 3', rows: 2 }]);
    expect(m.tags).toEqual([{ key: 'ночь', name: 'Ночь', rows: 2 }]);
  });

  it('строка с R17 ничего не добавляет в «Будет создано»: ни категории, ни контрагента, ни проекта, ни тега', () => {
    const rows = [
      r({ category: 'Реклама', counterparty: 'Новый К', project: 'Новый П', tags: ['Новый Т'] }),
      r({ category: 'Аренда', subcategory: 'Склад', counterparty: 'Новый К', project: 'Новый П', tags: ['Новый Т'] }),
      r({ category: 'Новая', subcategory: 'Дочерняя', tags: ['Старый', 'Новый Т'] }),
    ];
    const m = matchDictionaries(DICTS, rows);
    expect(m.issues.map((i) => i.row)).toEqual(rows.map((x) => x.row));
    expect(m.rows.size).toBe(0);
    expect(m.categories).toEqual([]);
    expect(m.counterparties).toEqual([]);
    expect(m.projects).toEqual([]);
    expect(m.tags).toEqual([]);
  });

  it('архивный тег и новый в одной строке: новый не считается; рядом успешная строка считается один раз', () => {
    const rows = [r({ tags: ['Старый', 'Свежий'] }), r({ tags: ['свежий'] })];
    const m = matchDictionaries(DICTS, rows);
    expect(m.rows.has(rows[0]!.row)).toBe(false);
    expect(m.tags).toEqual([{ key: 'свежий', name: 'свежий', rows: 1 }]);
  });

  it('архивная категория верхнего уровня без подкатегории — R17, даже если есть несколько активных дочерних с таким названием', () => {
    const d: Dictionaries = {
      ...DICTS,
      categories: [
        ...DICTS.categories,
        { id: 12, kind: 'expense', parentId: 4, name: 'Реклама', systemKey: null, archivedAt: null },
        { id: 13, kind: 'expense', parentId: 1, name: 'Реклама', systemKey: null, archivedAt: null },
      ],
    };
    const rows = [r({ category: 'Реклама' })];
    const m = matchDictionaries(d, rows);
    expect(m.issues.map((i) => i.message)).toEqual(['Категория «Реклама» в архиве — верните из архива']);
    expect(m.categories).toEqual([]);
    expect(m.rows.size).toBe(0);
  });

  it('архивная системная категория: R17 и без подкатегории, и с ней', () => {
    const d: Dictionaries = {
      ...DICTS,
      categories: [...DICTS.categories, { id: 12, kind: 'expense', parentId: null, name: 'Налоги', systemKey: 'tax', archivedAt: '2026-10-01T00:00:00.000Z' }],
    };
    const rows = [r({ category: 'налоги' }), r({ category: 'Налоги', subcategory: 'Взнос' })];
    const m = matchDictionaries(d, rows);
    expect(m.issues.map((i) => i.message)).toEqual(['Категория «налоги» в архиве — верните из архива', 'Категория «Налоги» в архиве — верните из архива']);
    expect(m.categories).toEqual([]);
  });

  it('один тег дважды в строке считается один раз', () => {
    const rows = [r({ tags: ['Новый', 'новый', 'Смена', 'смена'] })];
    const m = matchDictionaries(DICTS, rows);
    expect(m.tags).toEqual([{ key: 'новый', name: 'Новый', rows: 1 }]);
    expect(m.rows.get(rows[0]!.row)!.tags).toEqual([{ key: 'новый' }, { id: 1 }]);
  });
});
