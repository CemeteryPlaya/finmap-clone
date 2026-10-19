import { describe, expect, it } from 'vitest';
import type { StockItem } from '../../src/client/lib/stock';
import { emptyItemForm, itemBody, itemFormOf, newPartDraft } from '../../src/client/lib/stock-item-form';

const units = new Map([
  [1, 'pcs' as const],
  [2, 'l' as const],
]);

describe('форма товара: комплект (§2, решение 5 плана Склад-2)', () => {
  it('новый комплект: шт или уп, состав — товар и количество; признак уходит только при создании', () => {
    const form = { ...emptyItemForm(), name: 'Чипсы + кола', isCombo: true, parts: [{ ...newPartDraft(), itemId: 1, qty: '2' }, { ...newPartDraft(), itemId: 2, qty: '0,25' }] };
    expect(itemBody(form, 2, true, units)).toEqual({
      ok: true,
      body: {
        name: 'Чипсы + кола',
        groupId: null,
        unit: 'pcs',
        barcode: null,
        minQty: null,
        salePrice: 0,
        isCombo: true,
        parts: [
          { itemId: 1, qty: 2000 },
          { itemId: 2, qty: 250 },
        ],
      },
    });
  });

  it('ошибки состава: пусто, не выбран товар, повтор, дробные штуки, единица «л» у комплекта', () => {
    const combo = { ...emptyItemForm(), name: 'Набор', isCombo: true };
    expect(itemBody({ ...combo, parts: [] }, 2, true, units)).toEqual({ ok: false, errors: { parts: 'Добавьте хотя бы одну составляющую' } });
    const bad = {
      ...combo,
      unit: 'l' as const,
      parts: [
        { ...newPartDraft(), itemId: null, qty: '1' },
        { ...newPartDraft(), itemId: 1, qty: '1,5' },
        { ...newPartDraft(), itemId: 1, qty: '1' },
      ],
    };
    expect(itemBody(bad, 2, true, units)).toEqual({
      ok: false,
      errors: {
        unit: 'Комплект считается в штуках или упаковках',
        'parts.0.itemId': 'Выберите товар',
        'parts.1.qty': 'Количество в штуках — целое',
        'parts.2.itemId': 'Товар уже есть в составе',
      },
    });
  });

  it('правка: состав уходит, пока по комплекту нет документов; у товара с документами — нет', () => {
    const item = { id: 9, name: 'Набор', groupId: null, unit: 'pcs', barcode: null, isCombo: true, minQty: null, parts: [{ itemId: 1, qty: 1000 }], hasDocs: false } as unknown as StockItem;
    const form = itemFormOf(item);
    expect(form.parts.map((p) => [p.itemId, p.qty])).toEqual([[1, '1']]);
    expect(itemBody(form, 2, false, units)).toMatchObject({ ok: true, body: { parts: [{ itemId: 1, qty: 1000 }] } });
    expect(itemBody(itemFormOf({ ...item, hasDocs: true }), 2, false, units)).toMatchObject({ ok: true, body: expect.not.objectContaining({ parts: expect.anything() }) });
    // обычный товар состава не несёт
    expect(itemBody({ ...emptyItemForm(), name: 'Вода' }, 2, true, units)).toMatchObject({ ok: true, body: expect.not.objectContaining({ isCombo: true }) });
  });
});
