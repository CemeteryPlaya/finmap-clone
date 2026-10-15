import { getCurrency } from '../../shared/currencies';
import { formatMoney, MONEY_SCREEN } from '../../shared/money';
import { formatDateRu, isValidDate, parseTimeInput, timeOfDay, todayInTimezone } from '../../shared/dates';
import type { StockDocType, WriteoffReason } from '../../shared/schemas/stock';
import { lineAmount, parseQty, qtyInputText, unitPrice, type StockUnit } from '../../shared/stock-qty';
import { priceAt, type PricePoint } from '../../shared/stock-price';
import { parseAmountText } from './amount-input';
import { amountInputText, dayOf } from './journal-format';
import { paidAtFor, paidDateOf } from './operation-form';
import type { DocImpact, StockDoc } from './stock';

/** Строка документа в форме: количество, цена и сумма — текст полей; цена и сумма связаны (§4.2 спецификации «Склад»). */
export interface DocLineDraft {
  key: number;
  itemId: number | null;
  qty: string;
  price: string;
  amount: string;
  /** Что менялось последним: оно остаётся как есть, второе пересчитывается при смене количества. */
  driver: 'price' | 'amount';
  /** Цену или сумму правил сам пользователь: при смене даты документа цена продажи по умолчанию такую строку не трогает (R5). */
  edited: boolean;
}

/** Черновик документа склада. Дата и время — как у формы операции: нетронутая дата следует за «сегодня», время «живое». */
export interface DocDraft {
  type: StockDocType;
  warehouseId: number | null;
  counterpartyId: number | null;
  reason: WriteoffReason | null;
  paidDate: string;
  paidDateSet: boolean;
  paidTime: string;
  paidTimeSet: boolean;
  comment: string;
  lines: DocLineDraft[];
}

/** Что форме нужно знать о товаре. */
export interface ItemInfo {
  id: number;
  unit: StockUnit;
  prices: readonly PricePoint[];
}

let seq = 0;
export const newDocLine = (): DocLineDraft => ({ key: ++seq, itemId: null, qty: '', price: '', amount: '', driver: 'price', edited: false });

export function emptyDocDraft(type: StockDocType, today: string, warehouseId: number | null): DocDraft {
  return {
    type,
    warehouseId,
    counterpartyId: null,
    reason: type === 'writeoff' ? 'defect' : null,
    paidDate: today,
    paidDateSet: false,
    paidTime: '',
    paidTimeSet: false,
    comment: '',
    lines: [newDocLine()],
  };
}

/** Заголовок окна: «Новое поступление», «Поступление П-0001». */
export function docTitle(type: StockDocType, number: string | null): string {
  const names: Record<StockDocType, [string, string]> = {
    receipt: ['Новое поступление', 'Поступление'],
    sale: ['Новая продажа', 'Продажа'],
    writeoff: ['Новое списание', 'Списание'],
  };
  return number === null ? names[type][0] : `${names[type][1]} ${number}`;
}

/** Текст главной кнопки: «Добавить поступление» / «Сохранить изменения». */
export function docSubmitLabel(type: StockDocType, editing: boolean): string {
  if (editing) return 'Сохранить изменения';
  return { receipt: 'Добавить поступление', sale: 'Добавить продажу', writeoff: 'Добавить списание' }[type];
}

const minorOf = (currency: string) => getCurrency(currency).minorUnits;

/** Количество изменилось: цена остаётся и пересчитывает сумму, а если последней правили сумму — остаётся она и пересчитывается цена. */
export function setLineQty(line: DocLineDraft, text: string, unit: StockUnit, currency: string): DocLineDraft {
  const next = { ...line, qty: text };
  const q = parseQty(text, unit);
  // количество не разобрано («1,5» для «шт»): зависимое поле очищается, чтобы «Итого» не показывало устаревшее (R15)
  if (!q.ok) return line.driver === 'amount' ? { ...next, price: '' } : { ...next, amount: '' };
  const mu = minorOf(currency);
  if (line.driver === 'amount') {
    const a = parseAmountText(line.amount, mu);
    return a.ok ? { ...next, price: amountInputText(unitPrice(a.minor, q.qty), mu) } : next;
  }
  const p = parseAmountText(line.price, mu);
  return p.ok ? { ...next, amount: amountInputText(lineAmount(p.minor, q.qty), mu) } : next;
}

/** Цена изменилась: сумма = цена × количество. */
export function setLinePrice(line: DocLineDraft, text: string, unit: StockUnit, currency: string): DocLineDraft {
  const next: DocLineDraft = { ...line, price: text, driver: 'price', edited: true };
  const q = parseQty(line.qty, unit);
  const mu = minorOf(currency);
  const p = parseAmountText(text, mu);
  if (text.trim() === '') return { ...next, amount: '' };
  return q.ok && p.ok ? { ...next, amount: amountInputText(lineAmount(p.minor, q.qty), mu) } : next;
}

/** Сумма изменилась: цена = сумма / количество (до тиына; сохраняется сумма, итог документа точен до тиына). */
export function setLineAmount(line: DocLineDraft, text: string, unit: StockUnit, currency: string): DocLineDraft {
  const next: DocLineDraft = { ...line, amount: text, driver: 'amount', edited: true };
  const q = parseQty(line.qty, unit);
  const mu = minorOf(currency);
  const a = parseAmountText(text, mu);
  if (text.trim() === '') return { ...next, price: '' };
  return q.ok && a.ok ? { ...next, price: amountInputText(unitPrice(a.minor, q.qty), mu) } : next;
}

/** Выбран товар: у продажи цена по умолчанию — цена продажи товара на дату документа (§4.2). */
export function setLineItem(line: DocLineDraft, itemId: number | null, item: ItemInfo | undefined, type: StockDocType, day: string, currency: string): DocLineDraft {
  const next: DocLineDraft = { ...line, itemId };
  if (!item || type !== 'sale') return next;
  const price = priceAt(item.prices, day);
  // у нового товара нет цены на эту дату: прежняя цена и сумма от другого товара не остаются (R14)
  if (price <= 0) return line.edited ? next : { ...next, price: '', amount: '', driver: 'price' };
  return { ...setLinePrice({ ...next, qty: line.qty }, amountInputText(price, minorOf(currency)), item.unit, currency), edited: false };
}

/**
 * Дата документа изменилась: у строк продажи, где цену не правили руками, цена — цена продажи товара на новую дату
 * (если на эту дату цены ещё не было — поле очищается). Строки с правленной ценой или суммой остаются как есть.
 */
export function repriceSaleLines(lines: readonly DocLineDraft[], items: ReadonlyMap<number, ItemInfo>, day: string, currency: string): DocLineDraft[] {
  return lines.map((l) => {
    const item = l.itemId === null ? undefined : items.get(l.itemId);
    if (!item || l.edited) return l;
    const price = priceAt(item.prices, day);
    if (price <= 0) return { ...l, price: '', amount: '', driver: 'price' };
    return { ...setLinePrice(l, amountInputText(price, minorOf(currency)), item.unit, currency), edited: false };
  });
}

/** Строка пустая: товар не выбран и поля не тронуты — при сохранении пропускается. */
export function isBlankLine(l: DocLineDraft): boolean {
  return l.itemId === null && l.qty.trim() === '' && l.price.trim() === '' && l.amount.trim() === '';
}

/**
 * Ошибки сервера `lines.N.*` нумеруют строки без пустых (пустые в запрос не идут); в форме строки нумеруются все —
 * переводим номер сервера в номер строки формы (R18).
 */
export function mapServerLineErrors(fields: Record<string, string>, lines: readonly DocLineDraft[]): Record<string, string> {
  const sent = lines.map((l, index) => ({ l, index })).filter(({ l }) => !isBlankLine(l));
  return Object.fromEntries(
    Object.entries(fields).map(([k, v]) => {
      const m = /^lines\.(\d+)\.(.+)$/.exec(k);
      const at = m ? sent[Number(m[1])] : undefined;
      return [m && at ? `lines.${at.index}.${m[2]}` : k, v];
    }),
  );
}

/** Итог по строкам (поступление, продажа): сумма разобранных сумм; неразобранные не считаются. */
export function draftTotal(draft: Pick<DocDraft, 'lines'>, currency: string): number {
  const mu = minorOf(currency);
  return draft.lines.reduce((s, l) => {
    const a = parseAmountText(l.amount, mu);
    return a.ok ? s + a.minor : s;
  }, 0);
}

export interface DocBody {
  type: StockDocType;
  at: string;
  warehouseId: number;
  counterpartyId: number | null;
  reason: WriteoffReason | null;
  comment: string | null;
  lines: { itemId: number; qty: number; amount: number | null }[];
}

export type DocBuild = { ok: true; body: DocBody } | { ok: false; errors: Record<string, string> };

export interface DocContext {
  items: ReadonlyMap<number, ItemInfo>;
  currency: string;
  today: string;
  timeZone: string;
  now: Date;
  /** Откуда взять время суток: у нового документа — «сейчас», у существующего — его прежнее время. */
  timeOfDayFrom: Date;
  /** Правка: момент документа; если дата и время не менялись, он уходит как есть. */
  originalAt?: string;
}

export const DOC_COMMENT_MAX = 2000;

/** Черновик → тело запроса; ошибки — по полям формы (`warehouseId`, `reason`, `at`, `lines`, `lines.N.itemId|qty|amount`). */
export function buildDocBody(draft: DocDraft, ctx: DocContext): DocBuild {
  const errors: Record<string, string> = {};
  const mu = minorOf(ctx.currency);
  if (draft.warehouseId === null) errors.warehouseId = 'Выберите склад';
  if (draft.type === 'writeoff' && draft.reason === null) errors.reason = 'Укажите причину списания';

  const filled = draft.lines.map((l, index) => ({ l, index })).filter(({ l }) => !isBlankLine(l));
  if (filled.length === 0) errors.lines = 'Добавьте хотя бы одну строку';
  const lines: DocBody['lines'] = [];
  filled.forEach(({ l, index }, n) => {
    const item = l.itemId === null ? undefined : ctx.items.get(l.itemId);
    if (!item) {
      errors[`lines.${index}.itemId`] = 'Выберите товар';
      return;
    }
    const q = parseQty(l.qty, item.unit);
    if (!q.ok) errors[`lines.${index}.qty`] = q.error;
    let amount: number | null = null;
    if (draft.type !== 'writeoff') {
      const a = parseAmountText(l.amount, mu);
      if (!a.ok) errors[`lines.${index}.amount`] = l.amount.trim() === '' ? 'Укажите сумму' : a.error;
      else if (a.minor < 0) errors[`lines.${index}.amount`] = 'Сумма не меньше нуля';
      else amount = a.minor;
    }
    if (q.ok && !errors[`lines.${index}.amount`]) lines[n] = { itemId: item.id, qty: q.qty, amount };
  });

  const date = paidDateOf(draft, ctx.today);
  const time = draft.paidTimeSet ? parseTimeInput(draft.paidTime) : undefined;
  const dateUnchanged = ctx.originalAt !== undefined && dayOf(ctx.originalAt, ctx.timeZone) === date;
  if (!isValidDate(date)) errors.at = 'Укажите дату документа';
  else if (date > ctx.today && !dateUnchanged) errors.at = 'Дата документа в будущем — так нельзя';
  else if (time === null) errors.at = 'Укажите время в виде ЧЧ:ММ';
  else if (time !== undefined && Date.parse(paidAtFor(date, ctx.now, ctx.now, ctx.timeZone, time)) > ctx.now.getTime()) errors.at = 'Это время ещё не наступило';
  const comment = draft.comment.trim();
  if (comment.length > DOC_COMMENT_MAX) errors.comment = `Не длиннее ${DOC_COMMENT_MAX} символов`;

  if (Object.keys(errors).length > 0) return { ok: false, errors };
  const original = !draft.paidTimeSet && dateUnchanged ? (ctx.originalAt ?? null) : null;
  return {
    ok: true,
    body: {
      type: draft.type,
      at: original ?? paidAtFor(date, ctx.timeOfDayFrom, ctx.now, ctx.timeZone, time ?? undefined),
      warehouseId: draft.warehouseId!,
      counterpartyId: draft.type === 'writeoff' ? null : draft.counterpartyId,
      reason: draft.type === 'writeoff' ? draft.reason : null,
      comment: comment || null,
      lines,
    },
  };
}

/** Документ → черновик правки: количества и суммы — текстом полей, цена = сумма / количество. */
export function draftFromDoc(doc: StockDoc, items: ReadonlyMap<number, ItemInfo>, currency: string, timeZone: string): DocDraft {
  const mu = minorOf(currency);
  return {
    type: doc.type,
    warehouseId: doc.warehouseId,
    counterpartyId: doc.counterpartyId,
    reason: doc.reason,
    paidDate: dayOf(doc.at, timeZone),
    paidDateSet: true,
    paidTime: timeOfDay(doc.at, timeZone),
    paidTimeSet: false,
    comment: doc.comment ?? '',
    lines: doc.lines.map((l) => ({
      key: ++seq,
      itemId: l.itemId,
      qty: qtyInputText(l.qty),
      price: l.amount === null ? '' : amountInputText(unitPrice(l.amount, l.qty), mu),
      amount: l.amount === null ? '' : amountInputText(l.amount, mu),
      driver: 'amount' as const,
      edited: true,
    })),
  };
}

const genitive = (n: number, one: string, many: string) => (n % 10 === 1 && n % 100 !== 11 ? one : many);

/**
 * Предупреждение окна сохранения (§5.4 спецификации «Склад»): «Изменится себестоимость 3 продаж после 01.10.2026»;
 * со списаниями — «… 3 продаж и 1 списания …». Пусто, если чужие документы не затронуты.
 */
export function impactText(impact: DocImpact, timeZone: string): string | null {
  if (impact.sales + impact.writeoffs === 0) return null;
  const parts: string[] = [];
  if (impact.sales > 0) parts.push(`${impact.sales} ${genitive(impact.sales, 'продажи', 'продаж')}`);
  if (impact.writeoffs > 0) parts.push(`${impact.writeoffs} ${genitive(impact.writeoffs, 'списания', 'списаний')}`);
  const since = impact.since ? ` после ${formatDateRu(todayInTimezone(timeZone, new Date(impact.since)))}` : '';
  return `Изменится себестоимость ${parts.join(' и ')}${since}`;
}

/** Остаток суммы документа: «Оплачено X из Y», «Долг Z» или «Переплата Z». */
export function paymentState(total: number, paid: number): { kind: 'none' | 'partial' | 'paid' | 'over'; debt: number } {
  if (paid <= 0) return { kind: 'none', debt: total };
  if (paid < total) return { kind: 'partial', debt: total - paid };
  if (paid === total) return { kind: 'paid', debt: 0 };
  return { kind: 'over', debt: total - paid };
}

/** Строка «Оплата» в списке документов: «Долг 1 000 ₸», «Оплачено 400 ₸ из 1 000 ₸», «Оплачено», «Переплата 50 ₸». */
export function paymentLabel(total: number, paid: number, currency: string): string {
  const money = (minor: number) => formatMoney(minor, currency, MONEY_SCREEN);
  const state = paymentState(total, paid);
  if (state.kind === 'none') return `Долг ${money(total)}`;
  if (state.kind === 'partial') return `Оплачено ${money(paid)} из ${money(total)}`;
  if (state.kind === 'paid') return 'Оплачено';
  return `Переплата ${money(-state.debt)}`;
}

/** Итог оплаты в окне поступления (§6.1): «Оплачено X из Y. Долг Z» или «… Переплата Z». */
export function paymentSummary(total: number, paid: number, currency: string): string {
  const money = (minor: number) => formatMoney(minor, currency, MONEY_SCREEN);
  const state = paymentState(total, paid);
  if (state.kind === 'none') return `Не оплачено. Долг ${money(total)}`;
  const head = `Оплачено ${money(paid)} из ${money(total)}`;
  if (state.kind === 'partial') return `${head}. Долг ${money(state.debt)}`;
  if (state.kind === 'over') return `${head}. Переплата ${money(-state.debt)}`;
  return head;
}
