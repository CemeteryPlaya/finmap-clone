import { describe, expect, it } from 'vitest';
import { formatQty, isWholeUnit, lineAmount, parseQty, qtyError, qtyInputText, QTY_MAX, unitPrice } from '../../src/shared/stock-qty';

describe('parseQty', () => {
  it('штуки — целое число; запятая и точка с нулями допустимы', () => {
    expect(parseQty('12', 'pcs')).toEqual({ ok: true, qty: 12000 });
    expect(parseQty('2,0', 'pcs')).toEqual({ ok: true, qty: 2000 });
    expect(parseQty(' 1 500 ', 'pack')).toEqual({ ok: true, qty: 1_500_000 });
  });

  it('дробное количество штук — ошибка «Количество в штуках — целое»', () => {
    expect(parseQty('1,5', 'pcs')).toEqual({ ok: false, error: 'Количество в штуках — целое' });
    expect(parseQty('0.001', 'pack')).toEqual({ ok: false, error: 'Количество в штуках — целое' });
  });

  it('литры и килограммы — до трёх знаков', () => {
    expect(parseQty('1,5', 'l')).toEqual({ ok: true, qty: 1500 });
    expect(parseQty('.25', 'kg')).toEqual({ ok: true, qty: 250 });
    expect(parseQty('0,001', 'kg')).toEqual({ ok: true, qty: 1 });
    expect(parseQty('0,0001', 'kg')).toEqual({ ok: false, error: 'Не больше трёх знаков после запятой' });
  });

  it('пусто, ноль, мусор и слишком много — понятные ошибки', () => {
    expect(parseQty('', 'pcs')).toEqual({ ok: false, error: 'Введите количество' });
    expect(parseQty('0', 'pcs')).toEqual({ ok: false, error: 'Количество больше нуля' });
    expect(parseQty('-3', 'pcs').ok).toBe(false);
    expect(parseQty(',', 'l').ok).toBe(false);
    expect(parseQty('1000001', 'pcs')).toEqual({ ok: false, error: 'Слишком большое количество' });
  });
});

describe('qtyError', () => {
  it('сервер: целое больше нуля, у штук кратно 1000, не больше предела', () => {
    expect(qtyError(1000, 'pcs')).toBeNull();
    expect(qtyError(1500, 'pcs')).toBe('Количество в штуках — целое');
    expect(qtyError(1500, 'l')).toBeNull();
    expect(qtyError(0, 'l')).toBe('Количество больше нуля');
    expect(qtyError(1.5, 'l')).toBe('Количество больше нуля');
    expect(qtyError(QTY_MAX + 1, 'l')).toBe('Слишком большое количество');
  });

  it('isWholeUnit', () => {
    expect([isWholeUnit('pcs'), isWholeUnit('pack'), isWholeUnit('l'), isWholeUnit('kg')]).toEqual([true, true, false, false]);
  });
});

describe('formatQty и qtyInputText', () => {
  it('показ с разрядами и без лишних нулей', () => {
    expect(formatQty(2000)).toBe('2');
    expect(formatQty(1500)).toBe('1,5');
    expect(formatQty(250)).toBe('0,25');
    expect(formatQty(1_234_000)).toBe('1\u202F234');
    expect(formatQty(-3000)).toBe('\u22123');
    expect(qtyInputText(1_234_500)).toBe('1234,5');
  });
});

describe('lineAmount и unitPrice', () => {
  it('сумма = цена × количество до тиына half-up', () => {
    expect(lineAmount(15000, 3000)).toBe(45000);
    expect(lineAmount(15000, 1500)).toBe(22500);
    expect(lineAmount(333, 500)).toBe(167); // 166,5 -> 167
    expect(lineAmount(1, 1)).toBe(0);
  });

  it('цена из суммы и количества, количество 0 — 0', () => {
    expect(unitPrice(45000, 3000)).toBe(15000);
    expect(unitPrice(100, 3000)).toBe(33);
    expect(unitPrice(101, 3000)).toBe(34);
    expect(unitPrice(5, 0)).toBe(0);
  });

  it('большие суммы не теряют точность', () => {
    // произведение 9,007e18 не помещается в безопасное целое, результат 9 007 199 254 740 000 — помещается
    expect(lineAmount(9_007_199_254_740, 1_000_000)).toBe(9_007_199_254_740_000);
    expect(unitPrice(9_007_199_254_740_000, 1_000_000)).toBe(9_007_199_254_740);
  });
});
