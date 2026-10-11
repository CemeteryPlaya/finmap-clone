import { describe, expect, it } from 'vitest';
import { bulkEditActions, bulkEditSummary, bulkSummary, selectionTotals } from '../../src/client/lib/journal-bulk';

describe('итог массового действия (§7)', () => {
  it('«изменено N, пропущено M» и причины с числом операций в порядке первого появления', () => {
    expect(
      bulkSummary('setCategory', {
        changed: [1, 2, 3],
        skipped: [
          { id: 4, reason: 'Разбитая операция — измените её в форме' },
          { id: 5, reason: 'У перевода нет категории' },
          { id: 6, reason: 'Разбитая операция — измените её в форме' },
        ],
      }),
    ).toEqual({
      text: 'Категория: изменено 3, пропущено 3',
      reasons: [
        { reason: 'Разбитая операция — измените её в форме', count: 2 },
        { reason: 'У перевода нет категории', count: 1 },
      ],
    });
    expect(bulkSummary('delete', { changed: [1], skipped: [] })).toEqual({ text: 'Удаление: изменено 1, пропущено 0', reasons: [] });
    expect(bulkSummary('restore', { changed: [], skipped: [{ id: 1, reason: 'Операция не удалена' }] }).text).toBe('Отмена удаления: изменено 0, пропущено 1');
  });
});

describe('итог выделения (§5.5 этапа 1.5)', () => {
  const op = (type: 'income' | 'expense' | 'transfer', baseAmount: number) => ({ type, baseAmount });
  /** Неразрывные пробелы денег (U+00A0, U+202F) → обычные: так ожидания читаются. */
  const plain = (s: string) => s.replace(/[  ]/g, ' ');

  it('по типам в порядке Доход, Расход, Перевод; «платёж / платежа / платежей»; сумма — в базовой валюте; копейки только ненулевые (Review Focus 4)', () => {
    expect(plain(selectionTotals([op('expense', 800000), op('income', 4500000), op('income', 66600)], 'KZT'))).toBe('Доход • 2 платежа • 45 666 ₸ · Расход • 1 платёж • 8 000 ₸');
    expect(plain(selectionTotals([op('transfer', 50000), ...Array.from({ length: 5 }, () => op('expense', 100))], 'KZT'))).toBe('Расход • 5 платежей • 5 ₸ · Перевод • 1 платёж • 500 ₸');
    expect(plain(selectionTotals(Array.from({ length: 21 }, () => op('income', 150050)), 'KZT'))).toBe('Доход • 21 платёж • 31 510,50 ₸');
    // у счёта в долларах baseAmount уже в базовой валюте компании
    expect(plain(selectionTotals([op('income', 150050)], 'USD'))).toBe('Доход • 1 платёж • 1 500,50 $');
    expect(selectionTotals([], 'KZT')).toBe('');
  });
});

describe('«Изменить данные» (§5.5 этапа 1.5)', () => {
  const r = (changed: number[], skipped: { id: number; reason: string }[] = []) => ({ changed, skipped });

  it('только заполненные поля, по очереди: категория, проект, контрагент', () => {
    expect(bulkEditActions({ counterpartyId: 3, categoryId: null, projectId: 5 })).toEqual([
      { action: 'setProject', projectId: 5 },
      { action: 'setCounterparty', counterpartyId: 3 },
    ]);
    expect(bulkEditActions({ counterpartyId: null, categoryId: null, projectId: null })).toEqual([]);
    expect(bulkEditActions({ counterpartyId: 1, categoryId: 2, projectId: 3 }).map((a) => a.action)).toEqual(['setCategory', 'setProject', 'setCounterparty']);
  });

  it('итог — по каждому полю; если полей несколько, причины подписаны полем', () => {
    expect(bulkEditSummary([{ action: 'setCategory', result: r([1, 2], [{ id: 3, reason: 'Разбитая операция — измените её в форме' }]) }], null, [])).toEqual({
      text: 'Категория: изменено 2, пропущено 1',
      reasons: [{ reason: 'Разбитая операция — измените её в форме', count: 1 }],
    });
    expect(
      bulkEditSummary(
        [
          { action: 'setCategory', result: r([1], [{ id: 3, reason: 'Разбитая операция — измените её в форме' }]) },
          { action: 'setProject', result: r([1, 3]) },
        ],
        null,
        [],
      ),
    ).toEqual({
      text: 'Категория: изменено 1, пропущено 1. Проект: изменено 2, пропущено 0',
      reasons: [{ reason: 'Категория: Разбитая операция — измените её в форме', count: 1 }],
    });
  });

  it('упал запрос — следующие не выполняются, это видно в итоге (Review Focus 3)', () => {
    expect(bulkEditSummary([{ action: 'setCategory', result: r([1]) }], { action: 'setProject', message: 'Сбой' }, ['setCounterparty'])).toEqual({
      text: 'Категория: изменено 1, пропущено 0. Проект: ошибка — Сбой. Контрагент: не выполнено',
      reasons: [],
    });
    expect(bulkEditSummary([], { action: 'setCategory', message: 'Нет связи' }, []).text).toBe('Категория: ошибка — Нет связи');
  });
});
