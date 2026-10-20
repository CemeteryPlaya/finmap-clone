import type { Executor, Sqlite } from '../../db/client';
import { operationLines, operations, operationTags } from '../../db/schema';
import { assertInTx } from '../../db/tx';
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
   * Вставка операций импорта внутри транзакции вызывающего (§6.4 п. 3.5): пачками, без check() и load() на каждую
   * операцию. status = 'actual', version = 1, import_id. У дохода и расхода — одна строка на всю сумму (baseAmount строки =
   * baseAmount операции, инварианты 1–2); у перевода — строка только с проектом. Возвращает id операций в порядке rows.
   */
  insertImported(tx: Executor, batch: ImportBatch): Promise<number[]>;
}

/** Строк в одном INSERT: 16 параметров на операцию — далеко от пределов SQLite (32766) и Postgres (65535). */
const CHUNK = 500;

/**
 * sqlite — соединение better-sqlite3 (SQLite): операции пишутся подготовленными выражениями в его открытой транзакции —
 * так в 1,5–2 раза быстрее и экономнее по памяти на 50 000 строк, чем построитель (bench:import). Без него — пачками
 * через Drizzle (Postgres).
 */
export function createOperationsWriter(sqlite?: Sqlite): OperationsWriter {
  return {
    async insertImported(tx, b) {
      assertInTx(tx, 'insertImported');
      // дешёвые защитные проверки: вызывающий строит строки по инвариантам, но порча данных тише ошибки не бывает
      b.rows.forEach((r, i) => {
        const bad = (why: string) => new Error(`insertImported: строка ${i + 1}: ${why}`);
        if (!Number.isSafeInteger(r.amount) || r.amount <= 0) throw bad('сумма — положительное целое');
        if (!Number.isSafeInteger(r.baseAmount) || r.baseAmount < 0) throw bad('сумма в валюте компании — неотрицательное целое');
        if (r.type === 'transfer') {
          if (r.toAccountId === null || r.toAmount === null) throw bad('у перевода нужны счёт и сумма зачисления');
          if (!Number.isSafeInteger(r.toAmount) || r.toAmount <= 0) throw bad('сумма зачисления — положительное целое');
          if (r.categoryId !== null) throw bad('у перевода нет категории');
          if (r.toAccountId === r.accountId) throw bad('перевод на тот же счёт');
        } else if (r.toAccountId !== null || r.toAmount !== null) throw bad('счёт и сумма зачисления — только у перевода');
      });
      if (sqlite) return insertPrepared(sqlite, b);
      const ids: number[] = [];
      for (let start = 0; start < b.rows.length; start += CHUNK) {
        const part = b.rows.slice(start, start + CHUNK);
        const inserted = await tx
          .insert(operations)
          .values(
            part.map((r) => ({
              companyId: b.companyId,
              type: r.type,
              status: 'actual' as const,
              paidAt: new Date(r.paidAt).toISOString(),
              accrualDate: r.accrualDate,
              accountId: r.accountId,
              amount: r.amount,
              toAccountId: r.toAccountId,
              toAmount: r.toAmount,
              rate: r.rate,
              baseAmount: r.baseAmount,
              counterpartyId: r.counterpartyId,
              comment: r.comment,
              createdBy: b.userId,
              createdAt: b.at,
              updatedAt: b.at,
              version: 1,
              importId: b.importId,
            })),
          )
          .returning({ id: operations.id });
        // id одного INSERT растут в порядке строк VALUES; порядок строк RETURNING не гарантирован — сортируем
        const partIds = inserted.map((x) => x.id).sort((x, y) => x - y);
        // у перевода строка — только с проектом (§4.5 этапа 1); у дохода и расхода — всегда одна строка на всю сумму
        const lines = part.flatMap((r, i) =>
          r.type !== 'transfer' || r.projectId !== null
            ? [{ operationId: partIds[i]!, position: 0, categoryId: r.type === 'transfer' ? null : r.categoryId, projectId: r.projectId, amount: r.amount, baseAmount: r.baseAmount }]
            : [],
        );
        if (lines.length) await tx.insert(operationLines).values(lines);
        const opTags = part.flatMap((r, i) => [...new Set(r.tagIds)].sort((x, y) => x - y).map((tagId) => ({ operationId: partIds[i]!, tagId })));
        for (let t = 0; t < opTags.length; t += CHUNK) await tx.insert(operationTags).values(opTags.slice(t, t + CHUNK));
        ids.push(...partIds);
      }
      return ids;
    },
  };
}

function insertPrepared(sqlite: Sqlite, b: ImportBatch): number[] {
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
}
