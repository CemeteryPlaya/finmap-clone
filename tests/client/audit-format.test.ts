import { describe, expect, it } from 'vitest';
import { OPERATION_FIELD_LABELS } from '../../src/client/lib/history';
import { COMPANY_ENTITIES, diffRows, ENTITY_LABELS, formatBytes, pageDiff, SYSTEM_ENTITIES } from '../../src/client/lib/audit-format';

describe('audit-format', () => {
  it('diffRows: «было → стало» по полям before/after; иначе null', () => {
    expect(diffRows({ before: { name: 'А', archived: false }, after: { name: 'Б', templateParams: { pcCount: 30 } } })).toEqual([
      { field: 'name', before: 'А', after: 'Б' },
      { field: 'archived', before: 'false', after: '—' },
      { field: 'templateParams', before: '—', after: '{"pcCount":30}' },
    ]);
    expect(diffRows({ name: 'Касса' })).toBeNull();
    expect(diffRows({ before: null, after: {} })).toBeNull();
    expect(diffRows(null)).toBeNull();
  });

  it('diffRows операции: тип по-русски — «Расход → Перевод» (§10.1 этапа 1.5); у других сущностей type как есть', () => {
    const diff = { type: 'transfer', before: { type: 'expense', counterpartyId: 5 }, after: { type: 'transfer', counterpartyId: null } };
    expect(diffRows(diff, 'operation')).toEqual([
      { field: 'type', before: 'Расход', after: 'Перевод' },
      { field: 'counterpartyId', before: '5', after: 'null' },
    ]);
    expect(diffRows({ before: { type: 'client' }, after: { type: 'supplier' } }, 'counterparty')).toEqual([{ field: 'type', before: 'client', after: 'supplier' }]);
    expect(diffRows(diff)).toEqual([
      { field: 'type', before: 'expense', after: 'transfer' },
      { field: 'counterpartyId', before: '5', after: 'null' },
    ]);
  });

  it('formatBytes', () => {
    expect(formatBytes(500)).toBe('500 Б');
    expect(formatBytes(1536)).toBe('1,5 КБ');
    expect(formatBytes(1024 * 1024)).toBe('1 МБ');
    expect(formatBytes(5 * 1024 ** 3)).toBe('5 ГБ');
  });

  it('у каждой сущности фильтров есть подпись; операции, курсы и вложения — в своих лентах', () => {
    for (const e of [...COMPANY_ENTITIES, ...SYSTEM_ENTITIES]) expect(ENTITY_LABELS[e]).toBeTruthy();
    expect(ENTITY_LABELS).toMatchObject({ operation: 'Операция', rate: 'Курс', fixed_rate: 'Фиксированный курс', attachment: 'Вложение', import: 'Импорт' });
    expect(COMPANY_ENTITIES).toEqual(expect.arrayContaining(['operation', 'fixed_rate', 'attachment', 'import']));
    expect(SYSTEM_ENTITIES).toEqual(['user', 'rate']);
  });

  it('запись об импорте: подробности без «было / стало» показываются как есть (JSON с именем файла и числами)', () => {
    const diff = { fileName: 'выгрузка.xlsx', counts: { rows: 3, income: 1, expense: 1, transfer: 1, added: 3, duplicates: 0, skippedFuture: 0 }, created: { accounts: 1 } };
    expect(pageDiff({ entity: 'import', action: 'create', diff })).toBe(diff);
    expect(diffRows(diff, 'import')).toBeNull();
  });

  it('pageDiff: у операции — без счёта в удалении и без подробностей восстановления; остальные записи как есть', () => {
    const del = { entity: 'operation', action: 'delete', diff: { type: 'expense', amount: 100, accountId: 3, paidAt: '2026-10-05T10:00:00.000Z' } };
    expect(pageDiff(del)).toEqual({ type: 'expense', amount: 100, paidAt: '2026-10-05T10:00:00.000Z' });
    expect(pageDiff({ entity: 'operation', action: 'restore', diff: { type: 'expense', amount: 100, accountId: 3 } })).toBeNull();
    const update = { entity: 'operation', action: 'update', diff: { type: 'expense', before: { comment: null }, after: { comment: 'x' } } };
    expect(pageDiff(update)).toBe(update.diff);
    const tag = { entity: 'tag', action: 'delete', diff: { name: 'Аренда' } };
    expect(pageDiff(tag)).toBe(tag.diff);
    expect(pageDiff({ entity: 'operation', action: 'delete', diff: null })).toBeNull();
  });

  it('diffRows операции: доход по-русски, неизвестный тип — как есть', () => {
    expect(diffRows({ before: { type: 'income' }, after: { type: 'weird' } }, 'operation')).toEqual([{ field: 'type', before: 'Доход', after: 'weird' }]);
  });

  it('страница «История действий»: у каждого поля строки операции есть русское название (OPERATION_FIELD_LABELS)', () => {
    const diff = {
      before: { type: 'expense', accountId: 1, toAccountId: null, amount: 5, toAmount: null, counterpartyId: 5, accrualDate: null, comment: 'a', lines: [], tagIds: [], paidAt: 'x' },
      after: { type: 'transfer', accountId: 1, toAccountId: 2, amount: 5, toAmount: 5, counterpartyId: null, accrualDate: null, comment: 'a', lines: [], tagIds: [], paidAt: 'x' },
    };
    const names = diffRows(diff, 'operation')!.map((r) => OPERATION_FIELD_LABELS[r.field]);
    expect(names).toEqual(['Тип', 'Счёт', 'Счёт зачисления', 'Сумма', 'Сумма зачисления', 'Контрагент', 'Дата сделки', 'Комментарий', 'Категория и проект', 'Теги', 'Дата']);
  });
});
