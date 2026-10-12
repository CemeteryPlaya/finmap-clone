import type { Executor, Sqlite } from '../../db/client';
import type { OperationType } from './service';

/**
 * Операция импорта, готовая к записи (§6.4 спецификации импорта): все ссылки — id этой компании, суммы — в минимальных
 * единицах, курс и сумма в базовой валюте уже посчитаны предпросмотром. Инварианты обеспечены построением (§6.4 п. 4).
 */
export interface ImportedOperation {
  type: OperationType;
  /** ISO-момент UTC. */
  paidAt: string;
  accrualDate: string | null;
  accountId: number;
  amount: number;
  toAccountId: number | null;
  toAmount: number | null;
  rate: string;
  baseAmount: number;
  counterpartyId: number | null;
  comment: string | null;
  /** Категория единственной строки; у перевода — null. */
  categoryId: number | null;
  /** Проект строки; у перевода без проекта строки нет. */
  projectId: number | null;
  tagIds: number[];
}

export interface ImportBatch {
  companyId: number;
  importId: number;
  userId: number;
  /** Момент записи: created_at = updated_at. */
  at: string;
  /** В порядке записи: id растут по (paidAt, номер строки файла). */
  rows: readonly ImportedOperation[];
}

export interface OperationsWriter {
  /**
   * Вставка операций импорта внутри транзакции вызывающего (§6.4 п. 3.5): подготовленные выражения better-sqlite3,
   * созданные один раз на вызов, — без check() и load() на каждую операцию. status = 'actual', version = 1,
   * import_id. У дохода и расхода — одна строка на всю сумму (baseAmount строки = baseAmount операции, инварианты 1–2);
   * у перевода — строка только с проектом. Возвращает id операций в порядке rows.
   */
  insertImported(tx: Executor, batch: ImportBatch): number[];
}

/** sqlite — то же соединение, что у Drizzle (openDb): подготовленные выражения идут в его открытой транзакции. */
export function createOperationsWriter(sqlite: Sqlite): OperationsWriter {
  return {
    insertImported(_tx, b) {
      // tx — знак, что вызов внутри транзакции; сами вставки идут через соединение, на котором она открыта
      if (!sqlite.inTransaction) throw new Error('insertImported: только внутри транзакции');
      const insertOp = sqlite.prepare(
        `INSERT INTO operations (company_id, type, status, paid_at, accrual_date, account_id, amount, to_account_id, to_amount, rate,
           base_amount, counterparty_id, comment, created_by, created_at, updated_at, version, import_id)
         VALUES (?, ?, 'actual', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?)`,
      );
      const insertLine = sqlite.prepare('INSERT INTO operation_lines (operation_id, position, category_id, project_id, amount, base_amount) VALUES (?, 0, ?, ?, ?, ?)');
      const insertTag = sqlite.prepare('INSERT INTO operation_tags (operation_id, tag_id) VALUES (?, ?)');
      const ids: number[] = [];
      for (const r of b.rows) {
        const id = Number(
          insertOp.run(
            b.companyId,
            r.type,
            new Date(r.paidAt).toISOString(),
            r.accrualDate,
            r.accountId,
            r.amount,
            r.toAccountId,
            r.toAmount,
            r.rate,
            r.baseAmount,
            r.counterpartyId,
            r.comment,
            b.userId,
            b.at,
            b.at,
            b.importId,
          ).lastInsertRowid,
        );
        // у перевода строка — только с проектом (§4.5 этапа 1); у дохода и расхода — всегда одна строка на всю сумму
        if (r.type !== 'transfer' || r.projectId !== null) insertLine.run(id, r.type === 'transfer' ? null : r.categoryId, r.projectId, r.amount, r.baseAmount);
        for (const tagId of [...new Set(r.tagIds)].sort((x, y) => x - y)) insertTag.run(id, tagId);
        ids.push(id);
      }
      return ids;
    },
  };
}
