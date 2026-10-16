/**
 * «Выписка по счету» (§6 спецификации «Аналитика»): чистые функции — движение операции по одному счёту, сводка и остатки.
 * Все суммы — в валюте счёта, не в базовой: выписку сверяют с банком.
 */

/** Операция глазами одного счёта: тип, счёт списания и зачисления, суммы в их валютах. */
export interface StatementOp {
  type: 'income' | 'expense' | 'transfer';
  accountId: number;
  toAccountId: number | null;
  amount: number;
  toAmount: number | null;
}

/** Движение по счёту в его валюте: доход +, расход -, перевод со счёта - (сумма списания), на счёт + (сумма зачисления). */
export function statementDelta(op: StatementOp, accountId: number): number {
  if (op.type === 'transfer') return op.accountId === accountId ? -op.amount : (op.toAmount ?? 0);
  return op.type === 'income' ? op.amount : -op.amount;
}

/**
 * Строка выписки по счёту: движение, остаток этого счёта после операции (из журнала — у перевода на счёт это остаток
 * зачисления) и другой счёт перевода (для «Перевод: {другой счёт}»).
 */
export function statementLeg(
  item: StatementOp & { balanceAfter: number | null; toBalanceAfter: number | null },
  accountId: number,
): { delta: number; balance: number | null; other: number | null } {
  const outgoing = item.accountId === accountId;
  return {
    delta: statementDelta(item, accountId),
    balance: outgoing ? item.balanceAfter : item.toBalanceAfter,
    other: item.type !== 'transfer' ? null : outgoing ? item.toAccountId : item.accountId,
  };
}

/** Обороты счёта за период (§6): поступления, списания, переводы на счёт и со счёта — положительными суммами. */
export interface StatementTotals {
  income: number;
  expense: number;
  transfersIn: number;
  transfersOut: number;
}

/** Сводка выписки: обороты и остатки на начало и конец периода. */
export interface StatementSummary extends StatementTotals {
  start: number;
  end: number;
}

/** Остаток на конец = начало + поступления - списания + переводы на счёт - переводы со счёта: сводка сходится всегда. */
export function statementSummary(start: number, t: StatementTotals): StatementSummary {
  return { ...t, start, end: start + t.income - t.expense + t.transfersIn - t.transfersOut };
}

/** Числа сводки по порядку экрана и Excel. */
export const STATEMENT_SUMMARY: readonly { key: keyof StatementSummary; label: string }[] = [
  { key: 'start', label: 'Остаток на начало' },
  { key: 'income', label: 'Поступлений' },
  { key: 'expense', label: 'Списаний' },
  { key: 'transfersIn', label: 'Переводов на счёт' },
  { key: 'transfersOut', label: 'Переводов со счёта' },
  { key: 'end', label: 'Остаток на конец' },
];

/** «Категория» перевода в выписке (§6). */
export const transferLabel = (otherAccount: string) => `Перевод: ${otherAccount}`;
