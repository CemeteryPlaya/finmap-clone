import { and, eq, isNull, sql } from 'drizzle-orm';
import type { Db, Executor } from '../../db/client';
import { first, one, rows as sqlRows } from '../../db/raw';
import { accounts, counterparties, operations, projects, stockDocPostings, stockDocs, stockWarehouses } from '../../db/schema';
import { AppError } from '../../errors';
import { mutateAsync } from '../audit/mutate';
import type { AuditService } from '../audit/service';
import { requireCompany } from '../companies/guard';
import type { OperationsService } from '../operations/service';

/** Выручка продажи, проведённая доходом в журнал (§6.3 спецификации «Склад»). */
export interface DocPosting {
  operationId: number;
  /** Сумма операции журнала: правка продажи её не меняет, и они могут разойтись. */
  amount: number;
}

/** Что выбрано в прошлый раз для склада: счёт и категория (§6.3: «выбор запоминается для склада»). */
export interface LastPost {
  accountId: number;
  categoryId: number | null;
}

/** Проведение продажи, которое не удалено: удалённая операция освобождает продажу для нового проведения. */
export async function postingOf(ex: Executor, docId: number): Promise<DocPosting | null> {
  const row = await first(
    ex
      .select({ operationId: stockDocPostings.operationId, amount: operations.amount })
      .from(stockDocPostings)
      .innerJoin(operations, and(eq(operations.id, stockDocPostings.operationId), isNull(operations.deletedAt)))
      .where(eq(stockDocPostings.docId, docId)),
  );
  return row ?? null;
}

/** Какие из продаж проведены (для списка документов). */
export async function postedDocs(ex: Executor, docIds: readonly number[]): Promise<Set<number>> {
  if (docIds.length === 0) return new Set();
  const rows = await sqlRows<{ docId: number }>(
    ex,
    sql`
    SELECT p.doc_id AS docId FROM stock_doc_postings p JOIN operations o ON o.id = p.operation_id
     WHERE o.deleted_at IS NULL AND p.doc_id IN (${sql.join(docIds.map((id) => sql`${id}`), sql`, `)})`,
  );
  return new Set(rows.map((r) => r.docId));
}

/** Счёт и категория последнего проведения продаж этого склада. */
export async function lastPostOf(ex: Executor, warehouseId: number): Promise<LastPost | null> {
  const row = await one<{ accountId: number; categoryId: number | null }>(
    ex,
    sql`
    SELECT o.account_id AS accountId, (SELECT l.category_id FROM operation_lines l WHERE l.operation_id = o.id ORDER BY l.position LIMIT 1) AS categoryId
      FROM stock_doc_postings p
      JOIN stock_docs d ON d.id = p.doc_id
      JOIN operations o ON o.id = p.operation_id AND o.deleted_at IS NULL
     WHERE d.warehouse_id = ${warehouseId}
     ORDER BY o.paid_at DESC, o.id DESC LIMIT 1`,
  );
  return row ?? null;
}

export interface PostInput {
  accountId: number;
  categoryId: number;
}

export interface StockPostingsService {
  /** «Провести в журнал»: доходная операция на сумму продажи, проект склада, комментарий «Продажа {номер}». Повтор невозможен. */
  post(companyId: number, docId: number, input: PostInput, userId: number): Promise<{ operationId: number }>;
}

export function createStockPostingsService(d: { db: Db; audit: AuditService; operations: OperationsService }): StockPostingsService {
  const { db, audit, operations: ops } = d;
  return {
    async post(companyId, docId, input, userId) {
      const company = await requireCompany(db, companyId, { writable: true });
      return mutateAsync(
        db,
        audit,
        async (tx, record) => {
          const doc = await first(tx.select().from(stockDocs).where(and(eq(stockDocs.id, docId), eq(stockDocs.companyId, companyId))));
          if (!doc || doc.deletedAt) throw new AppError(404, 'NOT_FOUND', 'Документ не найден');
          if (doc.type !== 'sale') throw new AppError(422, 'VALIDATION', 'В журнал проводится только продажа');
          if (doc.source !== 'manual') throw new AppError(422, 'VALIDATION', 'Выручка бара проводится из смены в «Сверке Senet»');
          if (await postingOf(tx, docId)) throw new AppError(422, 'ALREADY_POSTED', 'Продажа уже проведена в журнал');
          const total = Number((await one<{ total: number }>(tx, sql`SELECT COALESCE(SUM(amount), 0) AS total FROM stock_doc_lines WHERE doc_id = ${docId}`))?.total ?? 0);
          if (total <= 0) throw new AppError(422, 'VALIDATION', 'Сумма продажи равна нулю — проводить нечего');
          // сумма документа — в валюте компании: на счёт в другой валюте она попала бы числом без пересчёта
          const account = await first(tx.select().from(accounts).where(and(eq(accounts.id, input.accountId), eq(accounts.companyId, companyId))));
          if (!account) throw new AppError(422, 'INVARIANT_5', 'Счёт не найден в этой компании', { accountId: 'Счёт не найден в этой компании' });
          if (account.currency !== company.baseCurrency) {
            const message = `Выручка проводится на счёт в валюте компании (${company.baseCurrency})`;
            throw new AppError(422, 'VALIDATION', message, { accountId: message });
          }
          const wh = (await first(tx.select().from(stockWarehouses).where(eq(stockWarehouses.id, doc.warehouseId))))!;
          // проект склада в архиве: операция журнала его не примет, а выбрать другой проект при проведении нельзя
          const project = await first(tx.select({ archivedAt: projects.archivedAt }).from(projects).where(eq(projects.id, wh.projectId)));
          if (project?.archivedAt) throw new AppError(422, 'ARCHIVED_REFERENCE', 'Проект склада в архиве — верните проект из архива, чтобы провести продажу');
          // покупатель мог уйти в архив: операция журнала ссылку на архивного контрагента не примет
          const buyer = doc.counterpartyId === null ? null : await first(tx.select().from(counterparties).where(eq(counterparties.id, doc.counterpartyId)));
          const counterpartyId = buyer && !buyer.archivedAt ? buyer.id : null;
          const op = await ops.create(
            companyId,
            {
              type: 'income',
              paidAt: doc.at,
              accrualDate: null,
              accountId: input.accountId,
              amount: total,
              toAccountId: null,
              toAmount: null,
              counterpartyId,
              comment: `Продажа ${doc.number}`,
              lines: [{ categoryId: input.categoryId, projectId: wh.projectId, amount: total }],
              tagIds: [],
            },
            userId,
          );
          // прежнее проведение, чья операция удалена, заменяется новым
          await tx.delete(stockDocPostings).where(eq(stockDocPostings.docId, docId));
          await tx.insert(stockDocPostings).values({ docId, operationId: op.id });
          await record({ companyId, userId, entity: 'stock_doc', entityId: docId, action: 'update', diff: { posted: { operationId: op.id, amount: total, number: doc.number } } });
          return { operationId: op.id };
        },
        { behavior: 'immediate' },
      );
    },
  };
}
