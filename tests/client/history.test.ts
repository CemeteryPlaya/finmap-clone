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
});
