import { isWholeUnit, parseQty, qtyInputText, type StockUnit } from '../../shared/stock-qty';
import { parseAmountText } from './amount-input';
import type { StockItem } from './stock';

/** Составляющая комплекта в форме: товар и количество на один комплект — текст поля. */
export interface PartDraft {
  key: number;
  itemId: number | null;
  qty: string;
}

/** Тело и ошибки полей формы товара. */
export interface ItemForm {
  name: string;
  groupId: number | null;
  unit: StockUnit;
  barcode: string;
  price: string;
  minQty: string;
  /** Комплект (решение 5 плана Склад-2): задаётся только при создании. */
  isCombo: boolean;
  parts: PartDraft[];
  /** Состав уже не меняется: по комплекту есть документы. */
  partsLocked: boolean;
}

let seq = 0;
export const newPartDraft = (): PartDraft => ({ key: ++seq, itemId: null, qty: '1' });

export const emptyItemForm = (): ItemForm => ({ name: '', groupId: null, unit: 'pcs', barcode: '', price: '', minQty: '', isCombo: false, parts: [], partsLocked: false });

export const itemFormOf = (item: StockItem): ItemForm => ({
  name: item.name,
  groupId: item.groupId,
  unit: item.unit,
  barcode: item.barcode ?? '',
  price: '',
  minQty: item.minQty === null ? '' : qtyInputText(item.minQty),
  isCombo: item.isCombo,
  parts: (item.parts ?? []).map((p) => ({ key: ++seq, itemId: p.itemId, qty: qtyInputText(p.qty) })),
  partsLocked: item.hasDocs,
});

/**
 * Форма → тело запроса; ошибки — по полям (`parts`, `parts.N.itemId|qty`). Цена учитывается только у нового товара
 * (у существующего — «Изменить цену»); состав комплекта уходит, пока по нему нет документов.
 */
export function itemBody(
  form: ItemForm,
  minorUnits: number,
  creating: boolean,
  units: ReadonlyMap<number, StockUnit>,
): { ok: true; body: Record<string, unknown> } | { ok: false; errors: Record<string, string> } {
  const errors: Record<string, string> = {};
  if (form.name.trim() === '') errors.name = 'Введите название';
  let salePrice = 0;
  if (creating && form.price.trim() !== '') {
    const r = parseAmountText(form.price, minorUnits);
    if (r.ok) salePrice = r.minor;
    else errors.price = r.error;
  }
  let minQty: number | null = null;
  if (form.minQty.trim() !== '') {
    const r = parseQty(form.minQty, form.unit);
    if (r.ok) minQty = r.qty;
    else errors.minQty = r.error;
  }
  const sendParts = form.isCombo && !form.partsLocked;
  const parts: { itemId: number; qty: number }[] = [];
  if (form.isCombo && !isWholeUnit(form.unit)) errors.unit = 'Комплект считается в штуках или упаковках';
  if (sendParts) {
    if (form.parts.length === 0) errors.parts = 'Добавьте хотя бы одну составляющую';
    const seen = new Set<number>();
    form.parts.forEach((p, i) => {
      if (p.itemId === null) {
        errors[`parts.${i}.itemId`] = 'Выберите товар';
        return;
      }
      if (seen.has(p.itemId)) {
        errors[`parts.${i}.itemId`] = 'Товар уже есть в составе';
        return;
      }
      seen.add(p.itemId);
      const q = parseQty(p.qty, units.get(p.itemId) ?? 'pcs');
      if (!q.ok) errors[`parts.${i}.qty`] = q.error;
      else parts.push({ itemId: p.itemId, qty: q.qty });
    });
  }
  if (Object.keys(errors).length > 0) return { ok: false, errors };
  const body: Record<string, unknown> = { name: form.name, groupId: form.groupId, unit: form.unit, barcode: form.barcode.trim() || null, minQty };
  if (creating) body.salePrice = salePrice;
  if (creating && form.isCombo) body.isCombo = true;
  if (sendParts) body.parts = parts;
  return { ok: true, body };
}
