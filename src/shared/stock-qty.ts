/**
 * Количество и цена товара (§5.1 спецификации «Склад»): количество — целое число тысячных долей единицы (1 шт = 1000),
 * деньги — минимальные единицы базовой валюты. Арифметика целочисленная, через bigint: произведение суммы на
 * количество не помещается в безопасное целое.
 */
export const STOCK_UNITS = ['pcs', 'l', 'kg', 'pack'] as const;
export type StockUnit = (typeof STOCK_UNITS)[number];

/** Подписи единиц на экране. */
export const UNIT_LABELS: Record<StockUnit, string> = { pcs: 'шт', l: 'л', kg: 'кг', pack: 'уп' };

/** Тысячных долей в единице. */
export const QTY_SCALE = 1000;
/** Наибольшее количество в строке: миллион единиц. */
export const QTY_MAX = 1_000_000 * QTY_SCALE;

export const WHOLE_UNIT_ERROR = 'Количество в штуках — целое';

/** Штуки и упаковки считаются поштучно: дробей нет. */
export function isWholeUnit(unit: StockUnit): boolean {
  return unit === 'pcs' || unit === 'pack';
}

/** Ошибка количества строки документа (для сервера) или null: целое, больше нуля, не больше предела, у «шт» кратно 1000. */
export function qtyError(qty: number, unit: StockUnit): string | null {
  if (!Number.isInteger(qty) || qty <= 0) return 'Количество больше нуля';
  if (qty > QTY_MAX) return 'Слишком большое количество';
  if (isWholeUnit(unit) && qty % QTY_SCALE !== 0) return WHOLE_UNIT_ERROR;
  return null;
}

export type QtyParse = { ok: true; qty: number } | { ok: false; error: string };

/** Текст поля количества → тысячные доли: «2», «1,5», «0.250». У «шт» и «уп» дробной части нет, у «л» и «кг» — до трёх знаков. */
export function parseQty(text: string, unit: StockUnit): QtyParse {
  const s = text.replace(/[\s\u00A0\u202F]/g, '').replace(',', '.');
  if (s === '') return { ok: false, error: 'Введите количество' };
  const m = /^(\d*)(?:\.(\d*))?$/.exec(s);
  if (!m || (m[1] === '' && !m[2])) return { ok: false, error: 'Введите количество, например 1,5' };
  const frac = m[2] ?? '';
  if (isWholeUnit(unit) && /[1-9]/.test(frac)) return { ok: false, error: WHOLE_UNIT_ERROR };
  if (!isWholeUnit(unit) && frac.length > 3) return { ok: false, error: 'Не больше трёх знаков после запятой' };
  const qty = Number(`${m[1] || '0'}${frac.padEnd(3, '0').slice(0, 3)}`);
  const error = qtyError(qty, unit);
  return error ? { ok: false, error } : { ok: true, qty };
}

/** Количество для показа: «2», «1,5», «0,25»; разряды — узким неразрывным пробелом. */
export function formatQty(qty: number): string {
  const abs = String(Math.abs(qty)).padStart(4, '0');
  const int = abs.slice(0, -3).replace(/\B(?=(\d{3})+(?!\d))/g, '\u202F');
  const frac = abs.slice(-3).replace(/0+$/, '');
  return `${qty < 0 ? '\u2212' : ''}${int}${frac ? `,${frac}` : ''}`;
}

/** Количество в поле ввода: «2», «1,5» — без разрядов, чтобы поле принимало его обратно. */
export function qtyInputText(qty: number): string {
  return formatQty(qty).replace(/\u202F/g, '');
}

/** Сумма строки = цена за единицу × количество, до тиына half-up. */
export function lineAmount(price: number, qty: number): number {
  const n = BigInt(price) * BigInt(qty);
  return Number((2n * n + 1000n) / 2000n);
}

/** Цена за единицу из суммы строки и количества, до тиына half-up; количество 0 — 0. */
export function unitPrice(amount: number, qty: number): number {
  if (qty <= 0) return 0;
  const n = BigInt(amount) * 1000n;
  const q = BigInt(qty);
  return Number((2n * n + q) / (2n * q));
}
