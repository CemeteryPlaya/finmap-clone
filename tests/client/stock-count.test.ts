import { describe, expect, it } from 'vitest';
import type { StockDoc } from '../../src/client/lib/stock';
import { countBody, countDiff, countDirty, countDraftFromDoc, countSnapshot, countSummaryText, type CountLineDraft } from '../../src/client/lib/stock-count';

const units = new Map([
  [1, 'pcs' as const],
  [2, 'l' as const],
]);
const line = (itemId: number, counted: string, expected: number | null = 3000): CountLineDraft => ({ key: itemId, itemId, expected, counted });

describe('инвентаризация: черновик (§7, Склад-2)', () => {
  it('черновик из документа: факт — текстом поля, пустой факт — пустое поле', () => {
    const doc = {
      lines: [
        { id: 1, position: 0, itemId: 1, qty: 0, amount: null, cost: null, uncovered: 0, countedQty: 2000, expected: 3000 },
        { id: 2, position: 1, itemId: 2, qty: 0, amount: null, cost: null, uncovered: 0, countedQty: null, expected: -250 },
      ],
    } as unknown as StockDoc;
    expect(countDraftFromDoc(doc).map((l) => [l.itemId, l.expected, l.counted])).toEqual([
      [1, 3000, '2'],
      [2, -250, ''],
    ]);
  });

  it('разница факт − учёт в тысячных; не введённый или неверный факт — null', () => {
    expect(countDiff(line(1, '1'), 'pcs')).toBe(-2000);
    expect(countDiff(line(2, '3,25'), 'l')).toBe(250);
    expect(countDiff(line(1, ''), 'pcs')).toBeNull();
    expect(countDiff(line(1, '1,5'), 'pcs')).toBeNull();
    expect(countDiff(line(1, '2', null), 'pcs')).toBeNull();
  });

  it('тело: черновик можно сохранить с пустым фактом, провести — нет; ноль — допустимый факт', () => {
    const lines = [line(1, '0'), line(2, '')];
    expect(countBody(lines, units, false)).toEqual({
      ok: true,
      lines: [
        { itemId: 1, countedQty: 0 },
        { itemId: 2, countedQty: null },
      ],
    });
    expect(countBody(lines, units, true)).toEqual({ ok: false, errors: { 'lines.1.counted': 'Внесите факт или удалите строку' } });
    expect(countBody([line(1, '1,5')], units, false)).toEqual({ ok: false, errors: { 'lines.0.counted': 'Количество в штуках — целое' } });
    expect(countBody([], units, true)).toEqual({ ok: false, errors: { lines: 'Добавьте хотя бы одну строку' } });
  });

  it('несохранённое — относительно последнего сохранения, а не открытия окна', () => {
    const opened = [line(1, ''), line(2, '1')];
    const saved = countSnapshot(opened);
    expect(countDirty(opened, saved)).toBe(false);
    const edited = [line(1, '2'), line(2, '1')];
    expect(countDirty(edited, saved)).toBe(true);
    // после сохранения (например, перед неудачным «Провести») снимок новый — правок нет
    expect(countDirty(edited, countSnapshot(edited))).toBe(false);
    // пробелы в поле не делают строку изменённой
    expect(countDirty([line(1, ' 2 '), line(2, '1')], countSnapshot(edited))).toBe(false);
    expect(countDirty([line(1, '2')], countSnapshot(edited))).toBe(true);
  });

  it('итог проведения: «Недостача на X, излишек на Y», товары без цены — отдельно', () => {
    expect(countSummaryText({ shortage: 24_000, surplus: 10_000, unknownCost: 0 }, 'KZT')).toBe('Недостача на 240 ₸, излишек на 100 ₸');
    expect(countSummaryText({ shortage: 0, surplus: 0, unknownCost: 2 }, 'KZT')).toBe('Недостача на 0 ₸, излишек на 0 ₸ · без цены: 2');
  });
});
