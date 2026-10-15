import { parseQty, qtyInputText, type StockUnit } from '../../shared/stock-qty';
import { parseAmountText } from './amount-input';
import type { StockItem } from './stock';

/** Тело и ошибки полей формы товара. */
export interface ItemForm {
  name: string;
  groupId: number | null;
  unit: StockUnit;
  barcode: string;
  price: string;
  minQty: string;
}

export const emptyItemForm = (): ItemForm => ({ name: '', groupId: null, unit: 'pcs', barcode: '', price: '', minQty: '' });

export const itemFormOf = (item: StockItem): ItemForm => ({
  name: item.name,
  groupId: item.groupId,
  unit: item.unit,
  barcode: item.barcode ?? '',
  price: '',
  minQty: item.minQty === null ? '' : qtyInputText(item.minQty),
});

/** Форма → тело запроса; ошибки — по полям. Цена учитывается только у нового товара (у существующего — «Изменить цену»). */
export function itemBody(form: ItemForm, minorUnits: number, creating: boolean): { ok: true; body: Record<string, unknown> } | { ok: false; errors: Record<string, string> } {
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
  if (Object.keys(errors).length > 0) return { ok: false, errors };
  const body: Record<string, unknown> = { name: form.name, groupId: form.groupId, unit: form.unit, barcode: form.barcode.trim() || null, minQty };
  if (creating) body.salePrice = salePrice;
  return { ok: true, body };
}
