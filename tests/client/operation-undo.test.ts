import { describe, expect, it } from 'vitest';
import { operationActionTitle, undoConfirmText, undoDoneText, undoEntryLine } from '../../src/client/lib/operation-undo';

describe('окно «Отменить действия?» (план 2026-10-20, задача 3)', () => {
  it('текст подтверждения: число действий по-русски', () => {
    expect(undoConfirmText(1)).toBe('Отменится 1 действие. Операция вернётся в состояние до него.');
    expect(undoConfirmText(2)).toBe('Отменятся 2 действия. Операция вернётся в состояние до них.');
    expect(undoConfirmText(5)).toBe('Отменятся 5 действий. Операция вернётся в состояние до них.');
    expect(undoConfirmText(21)).toBe('Отменится 21 действие. Операция вернётся в состояние до них.');
  });

  it('строка списка: действие, дата до секунд, сотрудник', () => {
    const e = { id: 7, action: 'update' as const, type: 'expense' as const, at: '2026-10-06T12:00:00.000Z', userName: 'Админ' };
    expect(undoEntryLine(e, 'Asia/Almaty')).toBe('Изменён расход · 06.10.2026, 17:00:00 · Админ');
    expect(undoEntryLine({ ...e, action: 'create', type: null, userName: null }, 'Asia/Almaty')).toBe('Добавлена операция · 06.10.2026, 17:00:00 · Система');
  });

  it('итог и заголовки действий', () => {
    expect(undoDoneText(1)).toBe('Отменено 1 действие');
    expect(undoDoneText(3)).toBe('Отменено 3 действия');
    expect(undoDoneText(5)).toBe('Отменено 5 действий');
    expect(operationActionTitle('delete', 'transfer')).toBe('Удалён перевод');
    expect(operationActionTitle('restore', null)).toBe('Восстановлена операция');
  });
});
