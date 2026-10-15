import { and, asc, desc, eq, inArray, isNull, sql } from 'drizzle-orm';
import type { Db, Executor } from '../../db/client';
import { operationLines, operations, stockDocPayments, stockDocs } from '../../db/schema';
import { AppError } from '../../errors';
import { requireCompany } from '../companies/guard';

/** Оплата поступления расходом журнала (§3.5, §6.1 спецификации «Склад»). */
export interface StockPaymentInput {
  docId: number;
  amount: number;
}

export interface StockPaymentDto extends StockPaymentInput {
  number: string;
}

/** Оплата глазами документа: какой расход и когда. */
export interface DocPayment {
  operationId: number;
  amount: number;
  paidAt: string;
}

export interface UnpaidDoc {
  docId: number;
  number: string;
  at: string;
  total: number;
  /** Сколько уже оплачено всеми неудалёнными расходами, включая расход, который правят. */
  paid: number;
  /** Сколько платит расход, который правят (0 — другой расход или новый). */
  own: number;
  /** Долг: сумма документа минус всё оплаченное; может быть отрицательным (переплата). */
  debt: number;
}

export interface UnpaidResult {
  docs: UnpaidDoc[];
  /** Категория последнего расхода с оплатой закупки этому поставщику — подсказка для формы. */
  lastCategoryId: number | null;
}

/** Расход без причины, по которой оплаты не действуют: удалённый расход оплату снимает (каскад, §6.1). */
const activeOp = (opAlias = 'o') => sql.raw(`${opAlias}.deleted_at IS NULL`);

/** Оплаты операции с номерами документов; оплаты удалённых документов не показываются. */
export function operationPayments(ex: Executor, operationId: number): StockPaymentDto[] {
  return ex
    .select({ docId: stockDocPayments.docId, amount: stockDocPayments.amount, number: stockDocs.number })
    .from(stockDocPayments)
    .innerJoin(stockDocs, and(eq(stockDocs.id, stockDocPayments.docId), isNull(stockDocs.deletedAt)))
    .where(eq(stockDocPayments.operationId, operationId))
    .orderBy(asc(stockDocPayments.docId))
    .all();
}

/** Сколько оплачено по каждому документу неудалёнными расходами. */
export function paidByDoc(ex: Executor, docIds: readonly number[]): Map<number, number> {
  const out = new Map<number, number>();
  if (docIds.length === 0) return out;
  const rows = ex.all<{ docId: number; paid: number }>(sql`
    SELECT p.doc_id AS docId, SUM(p.amount) AS paid
      FROM stock_doc_payments p JOIN operations o ON o.id = p.operation_id
     WHERE ${activeOp()} AND p.doc_id IN (${sql.join(docIds.map((id) => sql`${id}`), sql`, `)})
     GROUP BY p.doc_id`);
  for (const r of rows) out.set(r.docId, r.paid);
  return out;
}

/** Оплаты документа: расходы, которые не удалены. */
export function docPayments(ex: Executor, docId: number): DocPayment[] {
  return ex.all<DocPayment>(sql`
    SELECT p.operation_id AS operationId, p.amount AS amount, o.paid_at AS paidAt
      FROM stock_doc_payments p JOIN operations o ON o.id = p.operation_id
     WHERE ${activeOp()} AND p.doc_id = ${docId}
     ORDER BY o.paid_at, o.id`);
}

/**
 * Проверка оплат расхода (§6.1, §10): оплачивает только расход со счёта в валюте компании и с контрагентом; документы —
 * неудалённые поступления этого контрагента из этой компании; без повторов; сумма оплат не больше суммы расхода.
 * Переплата документа допустима.
 */
export function assertOperationPayments(
  ex: Executor,
  companyId: number,
  op: { type: string; amount: number; counterpartyId: number | null; accountCurrency: string; baseCurrency: string },
  payments: readonly StockPaymentInput[],
): void {
  if (payments.length === 0) return;
  const fail = (code: string, message: string) => new AppError(422, code, message, { stockPayments: message });
  if (op.type !== 'expense') throw fail('VALIDATION', 'Оплата закупки — только у расхода');
  if (op.accountCurrency !== op.baseCurrency) throw fail('VALIDATION', `Оплата закупки — только со счёта в валюте компании (${op.baseCurrency})`);
  if (op.counterpartyId === null) throw fail('VALIDATION', 'Для оплаты закупки выберите поставщика');
  if (new Set(payments.map((p) => p.docId)).size !== payments.length) throw fail('VALIDATION', 'Документ указан в оплатах дважды');
  const docs = new Map(
    ex
      .select()
      .from(stockDocs)
      .where(and(eq(stockDocs.companyId, companyId), inArray(stockDocs.id, payments.map((p) => p.docId))))
      .all()
      .map((d) => [d.id, d]),
  );
  for (const p of payments) {
    const doc = docs.get(p.docId);
    if (!doc || doc.deletedAt || doc.type !== 'receipt') throw fail('INVARIANT_5', 'Поступление не найдено или удалено');
    if (doc.counterpartyId !== op.counterpartyId) throw fail('VALIDATION', `Поступление ${doc.number} — от другого поставщика`);
  }
  if (payments.reduce((s, p) => s + p.amount, 0) > op.amount) throw fail('STOCK_PAYMENTS_EXCEED', 'Оплаты закупок больше суммы расхода');
}

/** Записать оплаты операции вместо прежних (в транзакции записи операции). */
export function replaceOperationPayments(tx: Executor, operationId: number, payments: readonly StockPaymentInput[]): void {
  tx.delete(stockDocPayments).where(eq(stockDocPayments.operationId, operationId)).run();
  for (const p of payments) tx.insert(stockDocPayments).values({ docId: p.docId, operationId, amount: p.amount }).run();
}

/** Поступления поставщика с долгом — для поля «Оплата закупки» расхода и для «Оплатить» у документа. */
export function unpaidDocs(db: Db, companyId: number, counterpartyId: number, operationId: number | null): UnpaidResult {
  requireCompany(db, companyId);
  const rows = db.all<{ docId: number; number: string; at: string; total: number }>(sql`
    SELECT d.id AS docId, d.number AS number, d.at AS at, COALESCE((SELECT SUM(l.amount) FROM stock_doc_lines l WHERE l.doc_id = d.id), 0) AS total
      FROM stock_docs d
     WHERE d.company_id = ${companyId} AND d.counterparty_id = ${counterpartyId} AND d.type = 'receipt' AND d.deleted_at IS NULL AND d.status = 'posted'
     ORDER BY d.at, d.id`);
  const paid = paidByDoc(db, rows.map((r) => r.docId));
  const own = new Map<number, number>();
  if (operationId !== null && rows.length > 0) {
    for (const p of db
      .select({ docId: stockDocPayments.docId, amount: stockDocPayments.amount })
      .from(stockDocPayments)
      .where(eq(stockDocPayments.operationId, operationId))
      .all()) {
      own.set(p.docId, p.amount);
    }
  }
  const docs = rows
    .map((r) => ({ ...r, paid: paid.get(r.docId) ?? 0, own: own.get(r.docId) ?? 0, debt: r.total - (paid.get(r.docId) ?? 0) }))
    .filter((r) => r.debt > 0 || r.own > 0);
  const last = db
    .select({ categoryId: operationLines.categoryId })
    .from(operations)
    .innerJoin(operationLines, eq(operationLines.operationId, operations.id))
    .innerJoin(stockDocPayments, eq(stockDocPayments.operationId, operations.id))
    .where(and(eq(operations.companyId, companyId), eq(operations.counterpartyId, counterpartyId), isNull(operations.deletedAt)))
    .orderBy(desc(operations.paidAt), desc(operations.id), asc(operationLines.position))
    .limit(1)
    .get();
  return { docs, lastCategoryId: last?.categoryId ?? null };
}
