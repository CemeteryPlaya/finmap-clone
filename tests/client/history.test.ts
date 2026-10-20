import { describe, expect, it } from 'vitest';
import { historyItems } from '../../src/client/lib/history';
import type { AuditEntry } from '../../src/client/lib/queries';

const accounts = new Map([
  [1, { name: 'Касса', currency: 'KZT' }],
  [2, { name: 'Валютный', currency: 'USD' }],
]);
const ctx = { accounts, timeZone: 'Asia/Almaty' };
const entry = (over: Partial<AuditEntry>): AuditEntry => ({
  id: 1,
  companyId: 1,
  userId: 1,
  userName: 'Админ',
  entity: 'operation',
  entityId: 10,
  action: 'create',
  diff: null,
  at: '2026-10-04T05:32:15.000Z',
  undoneBy: null,
  undoable: false,
  ...over,
});
/** Неразрывные пробелы денег → обычные: так ожидания читаются. */
const plain = (s: string | null) => (s === null ? null : s.replace(/[  ]/g, ' '));

describe('панель «История действий» (§3.4 этапа 1.5)', () => {
  it('добавление: действие и тип, сумма с ₸ впереди, счёт, пользователь и время до секунд', () => {
    const [item] = historyItems([entry({ diff: { type: 'income', amount: 131700, accountId: 1 } })], ctx);
    expect(item).toMatchObject({ title: 'Добавлен доход', type: 'income', account: 'Касса', changes: null, meta: 'Админ · 04.10.2026, 10:32:15', openable: true, operationId: 10 });
    expect(plain(item!.amount)).toBe('₸ 1 317');
  });

  it('правка: изменённые поля по-русски, без суммы', () => {
    const [item] = historyItems(
      [entry({ action: 'update', diff: { type: 'expense', before: { amount: 100, comment: null }, after: { amount: 200, comment: 'x' } } })],
      ctx,
    );
    expect(item).toMatchObject({ title: 'Изменён расход', amount: null, changes: 'Изменено: Сумма, Комментарий' });
  });

  it('смена типа (§6.8, §10.1): «Изменён перевод», «Тип: Расход → Перевод», затем остальные поля', () => {
    const [item] = historyItems(
      [
        entry({
          action: 'update',
          diff: { type: 'transfer', before: { type: 'expense', toAccountId: null, counterpartyId: 5 }, after: { type: 'transfer', toAccountId: 2, counterpartyId: null } },
        }),
      ],
      ctx,
    );
    expect(item).toMatchObject({ title: 'Изменён перевод', type: 'transfer', amount: null, changes: 'Тип: Расход → Перевод. Изменено: Счёт зачисления, Контрагент' });
  });

  it('смена типа с суммой зачисления: полная строка — «Тип: Расход → Перевод. Изменено: Счёт зачисления, Сумма зачисления, Контрагент»', () => {
    const [item] = historyItems(
      [
        entry({
          action: 'update',
          diff: {
            type: 'transfer',
            before: { type: 'expense', toAccountId: null, toAmount: null, counterpartyId: 5 },
            after: { type: 'transfer', toAccountId: 2, toAmount: 5000, counterpartyId: null },
          },
        }),
      ],
      ctx,
    );
    expect(item!.changes).toBe('Тип: Расход → Перевод. Изменено: Счёт зачисления, Сумма зачисления, Контрагент');
  });

  it('смена типа: доход — «Доход → Перевод»; неизвестный тип показан как есть', () => {
    const change = (before: string) =>
      historyItems([entry({ action: 'update', diff: { type: 'transfer', before: { type: before }, after: { type: 'transfer' } } })], ctx)[0]!.changes;
    expect(change('income')).toBe('Тип: Доход → Перевод');
    expect(change('weird')).toBe('Тип: weird → Перевод');
  });

  it('удалённую операцию не открыть — ни запись об удалении, ни более ранние; восстановленную — можно', () => {
    const list = historyItems(
      [
        entry({ id: 5, entityId: 20, action: 'delete', diff: { type: 'transfer', amount: 500, accountId: 2 } }),
        entry({ id: 4, entityId: 30, action: 'restore', diff: { type: 'expense', amount: 100, accountId: 1 } }),
        entry({ id: 3, entityId: 30, action: 'delete', diff: { type: 'expense', amount: 100, accountId: 1 } }),
        entry({ id: 2, entityId: 20, action: 'create', diff: { type: 'transfer', amount: 500, accountId: 2 } }),
      ],
      ctx,
    );
    expect(list.map((i) => [i.title, i.openable])).toEqual([
      ['Удалён перевод', false],
      ['Восстановлен расход', true],
      ['Удалён расход', true],
      ['Добавлен перевод', false],
    ]);
    expect(plain(list[0]!.amount)).toBe('$ 5');
  });

  it('старые записи без типа — «операция»; неизвестный счёт — без суммы; без пользователя — «Система»', () => {
    const list = historyItems(
      [entry({ action: 'update', diff: { before: { comment: null }, after: { comment: 'x' } } }), entry({ action: 'restore', diff: null, userName: null }), entry({ diff: { type: 'income', amount: 100, accountId: 99 } })],
      ctx,
    );
    expect(list.map((i) => i.title)).toEqual(['Изменена операция', 'Восстановлена операция', 'Добавлен доход']);
    expect(list[1]!.meta.startsWith('Система · ')).toBe(true);
    expect(list[2]).toMatchObject({ amount: null, account: null });
  });

  it('запись «Отмена»: что отменено — по типу каждого действия; отменённые и отменяемые записи (план 2026-10-20, задача 3)', () => {
    const undoDiff = { type: 'expense', undone: [{ id: 5, action: 'update', type: 'transfer' }, { id: 4, action: 'create', type: 'expense' }], deleted: true };
    const list = historyItems(
      [
        entry({ id: 6, action: 'undo', diff: undoDiff }),
        entry({ id: 5, action: 'update', undoneBy: 6, diff: { type: 'transfer', before: { type: 'expense' }, after: { type: 'transfer' } } }),
        entry({ id: 4, action: 'create', undoneBy: 6, diff: { type: 'expense', amount: 100, accountId: 1 } }),
        entry({ id: 3, entityId: 11, action: 'create', undoable: true, diff: { type: 'income', amount: 100, accountId: 1 } }),
      ],
      ctx,
    );
    expect(list[0]).toMatchObject({ title: 'Отмена', changes: 'Отменено: изменён перевод, добавлен расход', undone: false, undoable: false, openable: false });
    expect(list.map((i) => [i.id, i.undone, i.undoable, i.openable])).toEqual([
      [6, false, false, false],
      [5, true, false, false],
      [4, true, false, false],
      [3, false, true, true],
    ]);
    // отмена, после которой операция есть (отменено удаление), — открыть можно
    const restored = historyItems([entry({ id: 8, action: 'undo', diff: { type: 'expense', undone: [{ id: 7, action: 'delete', type: 'expense' }], deleted: false } })], ctx);
    expect(restored[0]).toMatchObject({ title: 'Отмена', changes: 'Отменено: удалён расход', openable: true });
  });
});
