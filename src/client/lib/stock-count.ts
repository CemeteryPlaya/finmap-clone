import { formatMoney, MONEY_SCREEN } from '../../shared/money';
import { isWholeUnit, parseQty, qtyInputText, QTY_SCALE, WHOLE_UNIT_ERROR, type StockUnit } from '../../shared/stock-qty';
import type { CountSummary, StockDoc } from './stock';

/** Строка инвентаризации в окне: учёт — от сервера, факт — текст поля (§7 спецификации «Склад»). */
export interface CountLineDraft {
  key: number;
  itemId: number;
  /** Остаток по учёту на момент документа; null — неизвестен (товар только что добавлен, ответа сервера ещё нет). */
  expected: number | null;
  counted: string;
}

let seq = 0;

export const newCountLine = (itemId: number): CountLineDraft => ({ key: ++seq, itemId, expected: null, counted: '' });

/** Строки окна из документа: факт — текстом поля, не посчитанный — пустое поле. */
export function countDraftFromDoc(doc: Pick<StockDoc, 'lines'>): CountLineDraft[] {
  return doc.lines.map((l) => ({ key: ++seq, itemId: l.itemId, expected: l.expected ?? null, counted: l.countedQty == null ? '' : qtyInputText(l.countedQty) }));
}

/** Факт поля → тысячные доли; ноль допустим (в отличие от количества документа). */
function parseCounted(text: string, unit: StockUnit): { ok: true; qty: number } | { ok: false; error: string } {
  if (text.replace(/[\s  ]/g, '') === '0') return { ok: true, qty: 0 };
  const q = parseQty(text, unit);
  if (!q.ok) return q;
  if (isWholeUnit(unit) && q.qty % QTY_SCALE !== 0) return { ok: false, error: WHOLE_UNIT_ERROR };
  return q;
}

/** Разница «факт − учёт» в тысячных: минус — недостача, плюс — излишек; null — факт не введён, неверен или учёт неизвестен. */
export function countDiff(line: CountLineDraft, unit: StockUnit): number | null {
  if (line.counted.trim() === '' || line.expected === null) return null;
  const q = parseCounted(line.counted, unit);
  return q.ok ? q.qty - line.expected : null;
}

export type CountBuild = { ok: true; lines: { itemId: number; countedQty: number | null }[] } | { ok: false; errors: Record<string, string> };

/**
 * Строки → тело запроса. Черновик сохраняется и с пустым фактом; «Провести» (`forPost`) требует факт у каждой строки.
 * Ошибки — `lines`, `lines.N.counted`.
 */
export function countBody(lines: readonly CountLineDraft[], units: ReadonlyMap<number, StockUnit>, forPost: boolean): CountBuild {
  const errors: Record<string, string> = {};
  if (forPost && lines.length === 0) errors.lines = 'Добавьте хотя бы одну строку';
  const out = lines.map((l, i) => {
    if (l.counted.trim() === '') {
      if (forPost) errors[`lines.${i}.counted`] = 'Внесите факт или удалите строку';
      return { itemId: l.itemId, countedQty: null };
    }
    const q = parseCounted(l.counted, units.get(l.itemId) ?? 'pcs');
    if (!q.ok) {
      errors[`lines.${i}.counted`] = q.error;
      return { itemId: l.itemId, countedQty: null };
    }
    return { itemId: l.itemId, countedQty: q.qty };
  });
  return Object.keys(errors).length > 0 ? { ok: false, errors } : { ok: true, lines: out };
}

/** Снимок сохранённых строк — основа для «есть несохранённое»: после каждого успешного сохранения он обновляется. */
export function countSnapshot(lines: readonly CountLineDraft[]): string {
  return JSON.stringify(lines.map((l) => [l.itemId, l.counted.trim()]));
}

/** В окне есть несохранённые правки: строки отличаются от последнего сохранённого снимка. */
export function countDirty(lines: readonly CountLineDraft[], saved: string): boolean {
  return countSnapshot(lines) !== saved;
}

/** Итог проведения: «Недостача на 240 ₸, излишек на 100 ₸», строки излишка без цены — « · без цены: N». */
export function countSummaryText(s: CountSummary, currency: string): string {
  const money = (minor: number) => formatMoney(minor, currency, MONEY_SCREEN);
  const head = `Недостача на ${money(s.shortage)}, излишек на ${money(s.surplus)}`;
  return s.unknownCost > 0 ? `${head} · без цены: ${s.unknownCost}` : head;
}
