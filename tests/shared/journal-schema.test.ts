import { describe, expect, it } from 'vitest';
import { journalExportSchema, journalFilterSchema, journalQuerySchema, type JournalFilter } from '../../src/shared/schemas/journal';

const issues = (r: { success: boolean; error?: { issues: { path: PropertyKey[]; message: string }[] } }) =>
  Object.fromEntries((r.error?.issues ?? []).map((i) => [i.path.join('.'), i.message]));

describe('journalQuerySchema (§6 «Фильтр журнала»)', () => {
  it('без параметров — сортировка по дате, новые сверху, страница 50', () => {
    expect(journalQuerySchema.parse({})).toEqual({ sort: 'date', order: 'desc', limit: 50 });
  });

  it('список: одиночное значение строкой (как его отдаёт Fastify) и повтор ключа — массивом; повторы и пустые убираются', () => {
    expect(journalQuerySchema.parse({ types: 'income' }).types).toEqual(['income']);
    const q = journalQuerySchema.parse({ types: ['transfer', 'income', 'transfer'], accountIds: ['3', '1', '', '3'] });
    expect(q.types).toEqual(['income', 'transfer']);
    expect(q.accountIds).toEqual([1, 3]);
    expect(journalQuerySchema.parse({ tagIds: '' }).tagIds).toBeUndefined();
  });

  it('флаги: true, "true", "1" — включены; "false", "0", пусто — не заданы; прочее — ошибка', () => {
    const q = journalQuerySchema.parse({ withoutCategory: '1', withoutProject: 'true', withoutCounterparty: 'false' });
    expect(q).toMatchObject({ withoutCategory: true, withoutProject: true });
    expect(q.withoutCounterparty).toBeUndefined();
    expect(issues(journalQuerySchema.safeParse({ withoutCategory: 'yes' }))).toEqual({ withoutCategory: 'Ожидается true или false' });
  });

  it('пустые строки — как отсутствие параметра; поиск обрезается, пустой поиск не задан', () => {
    expect(journalQuerySchema.parse({ amountMin: '', q: '   ', limit: '', from: '' })).toEqual({ sort: 'date', order: 'desc', limit: 50 });
    expect(journalQuerySchema.parse({ q: '  Аренда ' }).q).toBe('Аренда');
  });

  it('ошибки с полем: дата, конец раньше начала, «до» меньше «от», limit, тип, идентификатор, повтор скалярного ключа', () => {
    expect(issues(journalQuerySchema.safeParse({ from: '2026-02-31' }))).toEqual({ from: 'Неверная дата' });
    expect(issues(journalQuerySchema.safeParse({ from: '2026-10-05', to: '2026-10-01' }))).toEqual({ to: 'Конец периода раньше начала' });
    expect(issues(journalQuerySchema.safeParse({ amountMin: '100', amountMax: '50' }))).toEqual({ amountMax: '«До» меньше, чем «от»' });
    expect(issues(journalQuerySchema.safeParse({ limit: '500' }))).toEqual({ limit: 'От 1 до 200' });
    expect(issues(journalQuerySchema.safeParse({ types: 'bogus' }))).toEqual({ 'types.0': 'Неверный тип операции' });
    expect(issues(journalQuerySchema.safeParse({ accountIds: 'abc' }))).toEqual({ 'accountIds.0': 'Неверный идентификатор' });
    expect(journalQuerySchema.safeParse({ q: ['a', 'b'] }).success).toBe(false);
    expect(journalQuerySchema.safeParse({ amountMin: '10.5' }).success).toBe(false);
  });

  it('сортировка и размер страницы', () => {
    expect(journalQuerySchema.parse({ sort: 'amount', order: 'asc', limit: '10' })).toMatchObject({ sort: 'amount', order: 'asc', limit: 10 });
    expect(journalQuerySchema.safeParse({ sort: 'name' }).success).toBe(false);
  });
});

describe('journalFilterSchema и journalExportSchema', () => {
  it('сохранённый фильтр: JSON с числами, лишние поля (сортировка, курсор, мусор) отбрасываются', () => {
    const f: JournalFilter = journalFilterSchema.parse({ accountIds: [2, 1], withoutCategory: true, q: ' Бар ', sort: 'amount', cursor: 'x', junk: 1 });
    expect(f).toEqual({ accountIds: [1, 2], withoutCategory: true, q: 'Бар' });
    expect(JSON.parse(JSON.stringify(journalFilterSchema.parse({ withoutProject: false })))).toEqual({});
  });

  it('выгрузка: фильтр и сортировка без курсора и страницы; format по умолчанию — finmap, пустой — как отсутствующий, чужой — ошибка', () => {
    expect(journalExportSchema.parse({ types: 'expense', limit: '10', cursor: 'x' })).toEqual({ types: ['expense'], sort: 'date', order: 'desc', format: 'finmap' });
    expect(journalExportSchema.parse({ format: '' }).format).toBe('finmap');
    expect(journalExportSchema.safeParse({ format: 'csv' }).success).toBe(false);
  });
});

describe('journalFilterSchema: даты и тексты из сохранённого JSON (финальные правки 5a)', () => {
  it('год выше 9998 — «Неверная дата» (иначе addDays/startOfDayUtc дают NaN и 500)', () => {
    expect(issues(journalQuerySchema.safeParse({ to: '9999-12-31' }))).toEqual({ to: 'Неверная дата' });
    expect(issues(journalQuerySchema.safeParse({ from: '9999-01-01' }))).toEqual({ from: 'Неверная дата' });
    expect(journalQuerySchema.parse({ to: '9998-12-31' }).to).toBe('9998-12-31');
  });

  it('не строка в date и q — русское сообщение, а не английское по умолчанию zod', () => {
    expect(issues(journalFilterSchema.safeParse({ from: 20261001 }))).toEqual({ from: 'Неверная дата' });
    expect(issues(journalFilterSchema.safeParse({ q: 5 }))).toEqual({ q: 'Поиск — текст' });
  });
});
