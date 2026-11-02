import { describe, expect, it } from 'vitest';
import { parseBarPurchase } from '../../src/server/modules/senet/posting/bar';
import { classify } from '../../src/server/modules/senet/posting/classify';
import { normalize } from '../../src/server/modules/senet/posting/normalize';
import { buildRuleSet, type MatchMode, type RuleRow, type RuleType } from '../../src/server/modules/senet/posting/rules';

/** Справочники синтетического клуба: id категорий и контрагентов. */
const CAT = { salary: 1, lunch: 2, dividends: 3, bar: 4, repair: 5, water: 6, consumables: 7, loyalty: 8 } as const;
const CP = { op1: 11, op2: 12, master: 13, ownerA: 14, ownerB: 15, bakery: 16, drinks: 17 } as const;

let id = 0;
const row = (type: RuleType, pattern: string, match: MatchMode, o: Partial<RuleRow> = {}): RuleRow => ({
  id: ++id,
  officeId: null,
  type,
  pattern,
  match,
  priority: id,
  categoryId: null,
  counterpartyId: null,
  commentTemplate: null,
  flags: {},
  archived: false,
  ...o,
});

const ROWS: RuleRow[] = [
  row('kaspi', 'kaspi', 'phrase'),
  row('kaspi', 'каспи', 'phrase'),
  row('salary_word', '', 'word', { categoryId: CAT.salary }),
  row('salary_word', 'zp', 'word'),
  row('salary_word', 'зп', 'word'),
  row('salary_word', 'зарплата', 'first'),
  row('salary_word', 'аванс', 'first'),
  row('extra_pay_word', 'dop', 'word'),
  row('extra_pay_word', 'доп', 'word'),
  row('trainee', 'stajer', 'contains'),
  row('trainee', 'стажер', 'contains'),
  row('employee_alias', 'op1', 'word', { counterpartyId: CP.op1 }),
  row('employee_alias', 'оп1', 'word', { counterpartyId: CP.op1 }),
  row('employee_alias', 'op2', 'word', { counterpartyId: CP.op2 }),
  // ошибочный алиас: имя владельца в ЗП означает Оператора 2
  row('employee_alias', 'vla', 'word', { counterpartyId: CP.op2, flags: { mistaken: true } }),
  row('master', 'master1', 'word', { categoryId: CAT.repair, counterpartyId: CP.master }),
  row('owner_word', '', 'word', { categoryId: CAT.dividends, counterpartyId: CP.ownerB }),
  row('owner_word', 'vlb', 'word'),
  row('owner_word', 'deti', 'word'),
  row('owner_a_alias', '', 'word', { counterpartyId: CP.ownerA }),
  row('owner_a_alias', 'vla', 'word'),
  row('lunch', '', 'word', { categoryId: CAT.lunch }),
  row('lunch', 'obed', 'first'),
  row('lunch', 'обед', 'first'),
  row('keyword', 'voda', 'phrase', { categoryId: CAT.water, commentTemplate: 'вода' }),
  row('keyword', 'мусор', 'contains', { categoryId: CAT.consumables, commentTemplate: '{orig}' }),
  row('keyword', 'возврат', 'prefix', { categoryId: CAT.loyalty, commentTemplate: '{orig}' }),
  row('bar_item', '', 'contains', { categoryId: CAT.bar }),
  row('bar_item', 'gorilla', 'contains'),
  row('bar_item', 'dizzy', 'contains'),
  row('bar_item', 'brak', 'contains', { flags: { defect: true } }),
  row('bar_item', 'брак', 'contains', { flags: { defect: true } }),
  row('bar_supplier', '', 'contains', { counterpartyId: CP.drinks }),
  row('bar_supplier', 'sandwich', 'contains', { counterpartyId: CP.bakery }),
  row('bar_supplier', 'hot dog', 'contains', { counterpartyId: CP.bakery }),
];
const active = { categories: new Set<number>(Object.values(CAT)), counterparties: new Set<number>(Object.values(CP)) };
const rules = buildRuleSet(ROWS, 1, active);
const c = (comment: string) => classify(comment, rules);
const expense = (categoryId: number, counterpartyId: number | null, comment: string | null = null) => expect.objectContaining({ kind: 'expense', categoryId, counterpartyId, comment });

/** Классификация выемок (спецификация 2026-11-02-senet-autopost, §4.3; план, задача 8). */
describe('normalize', () => {
  it('регистр, «ё», пунктуация, пробелы', () => {
    expect(normalize('  ZP, Оп1!! ')).toBe('zp оп1');
    expect(normalize('Ёлка')).toBe('елка');
    expect(normalize('gorilla45x500')).toBe('gorilla45x500');
    expect(normalize('hot-dog  10x500')).toBe('hot dog 10x500');
  });
});

describe('classify', () => {
  it('каспи — только комментарий целиком', () => {
    expect(c('Kaspi')).toEqual({ kind: 'kaspi' });
    expect(c('каспи')).toEqual({ kind: 'kaspi' });
    expect(c('kaspi 5000')).toMatchObject({ kind: 'review', reason: 'unrecognized' });
  });

  it('зарплата: алиас, «аванс» первым словом, ошибочный алиас, доплата, без имени', () => {
    expect(c('zp op1')).toEqual(expense(CAT.salary, CP.op1));
    expect(c('ЗП, Оп1')).toEqual(expense(CAT.salary, CP.op1));
    expect(c('аванс op1')).toEqual(expense(CAT.salary, CP.op1));
    expect(c('op1 аванс')).toMatchObject({ kind: 'review', reason: 'unrecognized' });
    expect(c('zp vla')).toEqual(expense(CAT.salary, CP.op2));
    expect(c('dop zp')).toMatchObject({ kind: 'extra_pay', categoryId: CAT.salary });
    expect(c('zp')).toEqual({ kind: 'review', reason: 'salary_no_name', hint: { categoryId: CAT.salary } });
    expect(c('zp op1')).toMatchObject({ group: 'salary' });
  });

  it('стажёр — ЗП без контрагента с комментарием «стажер»', () => {
    expect(c('zp stajer')).toEqual(expense(CAT.salary, null, 'стажер'));
    expect(c('Стажер')).toEqual(expense(CAT.salary, null, 'стажер'));
    expect(c('stajer за два дня сверх')).toMatchObject({ kind: 'review' });
  });

  it('мастер — категория и контрагент мастера', () => {
    expect(c('master1 кран')).toEqual(expense(CAT.repair, CP.master));
  });

  it('дивиденды: только А — А; иначе — Б; новых контрагентов нет', () => {
    expect(c('vla')).toEqual(expense(CAT.dividends, CP.ownerA));
    expect(c('vla deti')).toEqual(expense(CAT.dividends, CP.ownerB));
    expect(c('vlb')).toEqual(expense(CAT.dividends, CP.ownerB));
    expect(c('vla за май')).toEqual(expense(CAT.dividends, CP.ownerB));
  });

  it('только имя сотрудника — в очередь с подсказкой ЗП', () => {
    expect(c('op1')).toEqual({ kind: 'review', reason: 'name_only', hint: { categoryId: CAT.salary, counterpartyId: CP.op1 } });
  });

  it('обед — первым словом целиком', () => {
    expect(c('obed')).toEqual(expect.objectContaining({ kind: 'expense', categoryId: CAT.lunch, group: 'lunch' }));
    expect(c('Обед 3000')).toMatchObject({ categoryId: CAT.lunch });
    expect(c('obed2')).toMatchObject({ kind: 'review' });
  });

  it('ключевые слова: фраза, подстрока, начало; комментарий — текст или исходный', () => {
    expect(c('voda')).toEqual(expense(CAT.water, null, 'вода'));
    expect(c('вода 5л')).toMatchObject({ kind: 'review' });
    expect(c('Мусорные пакеты')).toEqual(expense(CAT.consumables, null, 'Мусорные пакеты'));
    expect(c(' возвраты гостю ')).toEqual(expense(CAT.loyalty, null, 'возвраты гостю'));
  });

  it('бар: шаблон, поставщик по слову, по умолчанию, брак', () => {
    expect(c('gorilla45x500')).toEqual(expense(CAT.bar, CP.drinks));
    expect(c('gorilla45x500')).toMatchObject({ group: 'bar' });
    expect(c('sandwich10x500hot dog10x500')).toEqual(expense(CAT.bar, CP.bakery));
    expect(c('something 12x300')).toEqual(expense(CAT.bar, CP.drinks));
    expect(c('dizzy брак')).toEqual(expense(CAT.bar, CP.drinks, 'dizzy брак'));
  });

  it('иначе — unrecognized, пустой комментарий тоже', () => {
    expect(c('что-то')).toEqual({ kind: 'review', reason: 'unrecognized', hint: null });
    expect(c('')).toEqual({ kind: 'review', reason: 'unrecognized', hint: null });
  });

  it('точное правило — раньше всех', () => {
    const r = buildRuleSet([...ROWS, row('exact', 'zp op1', 'phrase', { categoryId: CAT.loyalty, counterpartyId: null, commentTemplate: 'особый случай' })], 1, active);
    expect(classify('ZP op1', r)).toEqual(expense(CAT.loyalty, null, 'особый случай'));
  });

  it('архивная категория у зарплаты — rule_broken; архивное правило не действует', () => {
    const noSalary = buildRuleSet(ROWS, 1, { ...active, categories: new Set([...active.categories].filter((x) => x !== CAT.salary)) });
    expect(classify('zp op1', noSalary)).toMatchObject({ kind: 'review', reason: 'rule_broken' });
    const archived = buildRuleSet(ROWS.map((r) => (r.pattern === 'voda' ? { ...r, archived: true } : r)), 1, active);
    expect(classify('voda', archived)).toMatchObject({ kind: 'review', reason: 'unrecognized' });
  });

  it('правило другого клуба не действует', () => {
    const r = buildRuleSet([...ROWS, row('keyword', 'свет', 'contains', { officeId: 2, categoryId: CAT.water })], 1, active);
    expect(classify('свет', r)).toMatchObject({ kind: 'review' });
    expect(classify('свет', buildRuleSet([...ROWS, row('keyword', 'свет', 'contains', { officeId: 2, categoryId: CAT.water })], 2, active))).toMatchObject({ categoryId: CAT.water });
  });
});

describe('parseBarPurchase', () => {
  it('несколько товаров в одной выемке; цена в тиынах, количество × 1000', () => {
    expect(parseBarPurchase('sandwich10x500hot dog10x500')).toEqual([
      { itemText: 'sandwich', qty: 10_000, price: 50_000, amount: 500_000 },
      { itemText: 'hot dog', qty: 10_000, price: 50_000, amount: 500_000 },
    ]);
    expect(parseBarPurchase('Gorilla 45 x 500')).toEqual([{ itemText: 'gorilla', qty: 45_000, price: 50_000, amount: 2_250_000 }]);
    expect(parseBarPurchase('dizzy брак')).toEqual([]);
  });
});
