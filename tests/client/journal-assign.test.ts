import { describe, expect, it } from 'vitest';
import { ApiError } from '../../src/client/lib/api';
import { assignPatch, canAssign, withAssigned, type AssignTarget } from '../../src/client/lib/journal-assign';
import { operationErrorText } from '../../src/client/lib/journal-mutations';

const FIELDS = ['counterparty', 'category', 'project'] as const;
const line = (categoryId: number | null, projectId: number | null, amount = 1000) => ({ id: 1, position: 0, categoryId, projectId, amount, baseAmount: amount });
const op = (patch: Partial<AssignTarget>): AssignTarget => ({
  type: 'expense',
  version: 3,
  amount: 1000,
  baseAmount: 1000,
  counterpartyId: null,
  lines: [line(null, null)],
  ...patch,
});

describe('«Указать» (§7)', () => {
  it('только пустая ячейка операции с одной строкой; проект — ещё у перевода без строк', () => {
    const bare = op({});
    expect(FIELDS.map((f) => canAssign(bare, f))).toEqual([true, true, true]);
    const filled = op({ counterpartyId: 5, lines: [line(7, 8)] });
    expect(FIELDS.map((f) => canAssign(filled, f))).toEqual([false, false, false]);
    // разбитая операция — только через форму
    const split = op({ lines: [line(null, null, 400), line(null, null, 600)] });
    expect(FIELDS.map((f) => canAssign(split, f))).toEqual([false, false, false]);
    // перевод: нет контрагента и статьи; проект — если строки нет или в ней нет проекта
    const transfer = op({ type: 'transfer', lines: [] });
    expect(FIELDS.map((f) => canAssign(transfer, f))).toEqual([false, false, true]);
    expect(canAssign(op({ type: 'transfer', lines: [line(null, 9)] }), 'project')).toBe(false);
  });

  it('тело PATCH: версия и одно поле; строка сохраняет остальные значения и сумму; перевод получает строку на всю сумму', () => {
    expect(assignPatch(op({}), 'counterparty', 5)).toEqual({ version: 3, counterpartyId: 5 });
    expect(assignPatch(op({ lines: [line(null, 8)] }), 'category', 7)).toEqual({ version: 3, lines: [{ categoryId: 7, projectId: 8, amount: 1000 }] });
    expect(assignPatch(op({ lines: [line(7, null)] }), 'project', 9)).toEqual({ version: 3, lines: [{ categoryId: 7, projectId: 9, amount: 1000 }] });
    expect(assignPatch(op({ type: 'transfer', amount: 47512, lines: [] }), 'project', 9)).toEqual({
      version: 3,
      lines: [{ categoryId: null, projectId: 9, amount: 47512 }],
    });
  });

  it('оптимистичный показ: значение подставлено, остальное как было', () => {
    expect(withAssigned(op({}), 'counterparty', 5).counterpartyId).toBe(5);
    expect(withAssigned(op({ lines: [line(null, 8)] }), 'category', 7).lines).toEqual([line(7, 8)]);
    expect(withAssigned(op({ type: 'transfer', amount: 500, baseAmount: 500, lines: [] }), 'project', 9).lines).toEqual([
      { id: 0, position: 0, categoryId: null, projectId: 9, amount: 500, baseAmount: 500 },
    ]);
  });

  it('текст ошибки: конфликт версии — журнал обновлён; удалённая операция — без «повторите»; прочее — как есть', () => {
    expect(operationErrorText(new ApiError(409, 'VERSION_CONFLICT', 'Операция изменена другим пользователем'))).toBe(
      'Операция изменена другим пользователем. Журнал обновлён — проверьте и повторите.',
    );
    expect(operationErrorText(new ApiError(409, 'VERSION_CONFLICT', 'Операция удалена — обновите страницу'))).toBe(
      'Операция удалена другим пользователем. Журнал обновлён.',
    );
    expect(operationErrorText(new ApiError(422, 'ARCHIVED_REFERENCE', 'Статья «Старая» в архиве — выберите другую'))).toBe('Статья «Старая» в архиве — выберите другую');
    expect(operationErrorText(new Error('x'))).toBe('Ошибка сервера');
  });
});
