import { describe, expect, it } from 'vitest';
import { OPERATION_FIELD_LABELS } from '../../src/client/lib/history';
import { auditSubject, COMPANY_ENTITIES, diffRows, ENTITY_LABELS, formatBytes, importDetails, pageDiff, SYSTEM_ENTITIES } from '../../src/client/lib/audit-format';

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
    expect(COMPANY_ENTITIES).toEqual(expect.arrayContaining(['operation', 'fixed_rate', 'attachment', 'import', 'indicator_part']));
    expect(ENTITY_LABELS.indicator_part).toBe('Финансовый показатель');
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

  it('импорт на странице «История действий»: имя файла рядом с «Импорт №…», в подробностях — числа (§6.5 спецификации импорта)', () => {
    const diff = {
      fileName: 'выгрузка.xlsx',
      counts: { rows: 1234, income: 700, expense: 500, transfer: 34, added: 1234, duplicates: 0, skippedFuture: 2 },
      created: { accounts: 2, categories: 12, counterparties: 25, projects: 0, tags: 1 },
    };
    expect(auditSubject({ entity: 'import', diff })).toBe('выгрузка.xlsx');
    expect(auditSubject({ entity: 'tag', diff: { name: 'x', fileName: 'y' } })).toBeNull();
    // часть финансового показателя: название части рядом с сущностью, в подробностях — одна строка «Настройка»
    const part = {
      part: 'variable',
      before: { allCategories: false, categories: [], includeStock: true, isDefault: true, text: 'Категорий нет, себестоимость склада (FIFO)' },
      after: { allCategories: false, categories: ['Закуп бара'], includeStock: false, isDefault: false, text: 'Закуп бара' },
    };
    expect(auditSubject({ entity: 'indicator_part', diff: part })).toBe('Переменные расходы');
    expect(auditSubject({ entity: 'indicator_part', diff: { part: 'toString' } })).toBeNull();
    expect(diffRows(part, 'indicator_part')).toEqual([{ field: 'Настройка', before: 'Категорий нет, себестоимость склада (FIFO)', after: 'Закуп бара' }]);
    expect(importDetails({ entity: 'import', action: 'create', diff })).toEqual([
      { label: 'Строк в файле', value: '1\u202F234' },
      { label: 'Добавлено', value: '1\u202F234 операции (доходов 700, расходов 500, переводов 34)' },
      { label: 'Пропущено дубликатов', value: '0' },
      { label: 'Пропущено плановых', value: '2' },
      { label: 'Создано', value: '2 счёта, 12 категорий, 25 контрагентов, 1 тег' },
    ]);
    expect(importDetails({ entity: 'import', action: 'create', diff: { ...diff, created: { accounts: 0, categories: 0, counterparties: 0, projects: 0, tags: 0 } } })!.at(-1)).toEqual({
      label: 'Создано',
      value: 'ничего',
    });
  });

  it('отмена импорта: в подробностях — итог; запись другого вида или с неполным diff — как есть (null)', () => {
    const zero = { accounts: 0, categories: 0, counterparties: 0, projects: 0, tags: 0 };
    const diff = {
      fileName: 'выгрузка.xlsx',
      deleted: { operations: 3, ...zero, accounts: 1 },
      kept: { operations: 1, created: { ...zero, categories: 1 }, names: [{ entity: 'category', name: 'Бар' }], accounts: [] },
    };
    expect(importDetails({ entity: 'import', action: 'delete', diff })).toEqual([
      { label: 'Итог', value: 'Импорт отменён: удалено 3 операции, 1 счёт. Оставлено: 1 изменённая операция, категория «Бар» (используется).' },
    ]);
    expect(importDetails({ entity: 'import', action: 'delete', diff: { fileName: 'x', deleted: { operations: 1 } } })).toBeNull();
    // элементы kept.names и kept.accounts неизвестного вида — как есть, а не исключение при показе
    expect(importDetails({ entity: 'import', action: 'delete', diff: { ...diff, kept: { ...diff.kept, names: [null] } } })).toBeNull();
    expect(importDetails({ entity: 'import', action: 'delete', diff: { ...diff, kept: { ...diff.kept, names: [{ entity: 'user', name: 'x' }] } } })).toBeNull();
    expect(importDetails({ entity: 'import', action: 'delete', diff: { ...diff, kept: { ...diff.kept, accounts: [null] } } })).toBeNull();
    expect(
      importDetails({ entity: 'import', action: 'delete', diff: { ...diff, kept: { ...diff.kept, accounts: [{ accountId: 1, name: 'Касса', field: 'openedAt', reason: 'other' }] } } }),
    ).toBeNull();
    expect(importDetails({ entity: 'import', action: 'create', diff: { fileName: 'x' } })).toBeNull();
    expect(importDetails({ entity: 'tag', action: 'create', diff: { name: 'x' } })).toBeNull();
    expect(importDetails({ entity: 'import', action: 'create', diff: null })).toBeNull();
  });

  it('отмена импорта: в итоге — поля счетов, обнулённый стартовый баланс созданного счёта и «и ещё N»', () => {
    const zero = { accounts: 0, categories: 0, counterparties: 0, projects: 0, tags: 0 };
    const diff = {
      fileName: 'выгрузка.xlsx',
      deleted: { operations: 2, ...zero },
      kept: {
        operations: 0,
        created: { ...zero, accounts: 1, counterparties: 21 },
        names: [{ entity: 'account', name: 'Банк-2' }, ...Array.from({ length: 19 }, (_, i) => ({ entity: 'counterparty', name: `К${i}` }))],
        accounts: [
          { accountId: 1, name: 'Касса', field: 'startingBalance', reason: 'changed' },
          { accountId: 5, name: 'Банк-2', field: 'startingBalance', reason: 'created' },
        ],
      },
    };
    const value = importDetails({ entity: 'import', action: 'delete', diff })![0]!.value;
    expect(value).toMatch(/^Импорт отменён: удалено 2 операции\. Оставлено: счёт «Банк-2» \(используется\), контрагент «К0» \(используется\), /);
    expect(value).toContain('контрагент «К18» (используется), и ещё 2 (используются), стартовый баланс счёта «Касса» (изменён после импорта). ');
    expect(value).toMatch(/ Счёт «Банк-2» оставлен: на нём есть операции; стартовый баланс обнулён — проверьте его в настройках счетов\.$/);
  });
});
