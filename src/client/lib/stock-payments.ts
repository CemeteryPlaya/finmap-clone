import { formatMoney, MONEY_SCREEN } from '../../shared/money';
import { getCurrency } from '../../shared/currencies';
import { parseAmountText } from './amount-input';
import { amountInputText } from './journal-format';
import type { UnpaidDoc } from './stock';

/** Оплата закупки в форме расхода: какой документ и сколько платит этот расход (текст поля суммы). */
export interface PaymentDraft {
  docId: number;
  amount: string;
}

export type ParsedPayments = { ok: true; list: { docId: number; amount: number }[]; total: number } | { ok: false; error: string };

/** Разобрать оплаты формы: каждая сумма больше нуля. Пустой список — оплат нет. */
export function parsePayments(payments: readonly PaymentDraft[], minorUnits: number): ParsedPayments {
  const list: { docId: number; amount: number }[] = [];
  for (const p of payments) {
    const r = parseAmountText(p.amount, minorUnits);
    if (!r.ok || r.minor <= 0) return { ok: false, error: 'Укажите сумму оплаты по каждому документу' };
    list.push({ docId: p.docId, amount: r.minor });
  }
  return { ok: true, list, total: list.reduce((s, p) => s + p.amount, 0) };
}

/** Сколько ещё можно распределить из суммы расхода (без учёта документа exceptDocId); null — сумма расхода не введена. */
export function remainingAmount(opAmount: number | null, payments: readonly PaymentDraft[], minorUnits: number, exceptDocId?: number): number | null {
  if (opAmount === null) return null;
  const used = payments.filter((p) => p.docId !== exceptDocId).reduce((s, p) => {
    const r = parseAmountText(p.amount, minorUnits);
    return r.ok ? s + r.minor : s;
  }, 0);
  return Math.max(opAmount - used, 0);
}

/** Сумма по умолчанию: долг документа (без этого расхода), но не больше остатка суммы расхода. */
export function defaultPaymentAmount(doc: Pick<UnpaidDoc, 'debt' | 'own'>, remaining: number | null): number {
  const owed = Math.max(doc.debt + doc.own, 0);
  return remaining === null ? owed : Math.min(owed, remaining);
}

/** Отметить документ: оплата по умолчанию — долг, но не больше остатка суммы расхода. */
export function withDoc(payments: readonly PaymentDraft[], doc: UnpaidDoc, opAmount: number | null, minorUnits: number): PaymentDraft[] {
  if (payments.some((p) => p.docId === doc.docId)) return [...payments];
  const amount = defaultPaymentAmount(doc, remainingAmount(opAmount, payments, minorUnits));
  return [...payments, { docId: doc.docId, amount: amount > 0 ? amountInputText(amount, minorUnits) : '' }];
}

export function withoutDoc(payments: readonly PaymentDraft[], docId: number): PaymentDraft[] {
  return payments.filter((p) => p.docId !== docId);
}

export function withAmount(payments: readonly PaymentDraft[], docId: number, amount: string): PaymentDraft[] {
  return payments.map((p) => (p.docId === docId ? { ...p, amount } : p));
}

/** «Распределено ₸ 600 из ₸ 1 000» — под списком документов. */
export function distributedText(payments: readonly PaymentDraft[], opAmount: number | null, currency: string): string {
  const mu = getCurrency(currency).minorUnits;
  const total = payments.reduce((s, p) => {
    const r = parseAmountText(p.amount, mu);
    return r.ok ? s + r.minor : s;
  }, 0);
  const money = (minor: number) => formatMoney(minor, currency, MONEY_SCREEN);
  return opAmount === null ? `Распределено ${money(total)}` : `Распределено ${money(total)} из ${money(opAmount)}`;
}

/** Строка документа в списке: «П-0001 от 01.10.2026 · сумма 1 000 ₸ · долг 600 ₸». */
export function unpaidDocText(doc: UnpaidDoc, dateText: string, currency: string): string {
  const money = (minor: number) => formatMoney(minor, currency, MONEY_SCREEN);
  const owed = doc.debt + doc.own;
  return `${doc.number} от ${dateText} · сумма ${money(doc.total)} · ${owed > 0 ? `долг ${money(owed)}` : 'оплачено'}`;
}
