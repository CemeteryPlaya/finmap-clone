import { and, desc, eq, gte, inArray, isNull } from 'drizzle-orm';
import { UNDO_CASCADE_MAX, type UndoableAction, type UndoneAction, type UndoOperationType, type UndoPreview, type UndoResult } from '../../../shared/schemas/audit';
import type { Db, Executor } from '../../db/client';
import { first } from '../../db/raw';
import { withTx } from '../../db/tx';
import { auditLog, auditUndo, operations, users } from '../../db/schema';
import { AppError } from '../../errors';
import { lastDeleteSql, UNDOABLE_ACTIONS, type AuditService } from '../audit/service';
import { requireCompany } from '../companies/guard';
import type { OperationInput, OperationsService, RevertStep } from './service';

/**
 * «Отмена» в «Истории действий» журнала (спецификация 2026-10-19, часть 2; план 2026-10-20, решения 3–7, R5, R10, R14):
 * каскад — неотменённые действия той же операции с id не меньше выбранного, от последнего к выбранному; всё — одной
 * транзакцией BEGIN IMMEDIATE. Шаги идут через operations.revert (те же проверки, что у правки), история — одна запись
 * «Отмена» и отметки audit_undo.
 */
export interface OperationUndoService {
  preview(companyId: number, entryId: number): Promise<UndoPreview>;
  run(companyId: number, entryId: number, ids: number[], userId: number): Promise<UndoResult>;
}

type AuditRow = typeof auditLog.$inferSelect;

/** Поля черновика операции: «было» правки переносится только по ним (старые записи могли нести что-то ещё). */
const INPUT_FIELDS: readonly (keyof OperationInput)[] = [
  'type',
  'paidAt',
  'accrualDate',
  'accountId',
  'amount',
  'toAccountId',
  'toAmount',
  'counterpartyId',
  'comment',
  'lines',
  'tagIds',
  'stockPayments',
];

const unsupported = (message = 'Это действие отменить нельзя') => new AppError(422, 'UNDO_UNSUPPORTED', message);

/** Каскад длиннее предела не отменяется одной отменой (R14). */
export function assertCascadeSize(n: number): void {
  if (n > UNDO_CASCADE_MAX) throw new AppError(422, 'UNDO_TOO_LONG', 'Слишком много действий для одной отмены — отмените сначала более поздние');
}

/**
 * Раньше какой записи отменять нельзя (R5): у удалённой операции — её последнее неотменённое «Удаление» (нет такого —
 * отменять нечего); у неудалённой — ограничения нет (null).
 */
export async function undoBlock(ex: Executor, companyId: number, operationId: number): Promise<number | null> {
  const op = await first(
    ex.select({ deletedAt: operations.deletedAt }).from(operations).where(and(eq(operations.id, operationId), eq(operations.companyId, companyId))),
  );
  if (!op?.deletedAt) return null;
  return (await first(ex.select({ id: lastDeleteSql(companyId, operationId) }).from(operations).where(eq(operations.id, operationId))))?.id ?? Number.MAX_SAFE_INTEGER;
}

const diffOf = (row: AuditRow): Record<string, unknown> => (row.diff ? (JSON.parse(row.diff) as Record<string, unknown>) : {});
const typeOf = (row: AuditRow): UndoOperationType | null => {
  const t = diffOf(row).type;
  return t === 'income' || t === 'expense' || t === 'transfer' ? t : null;
};

/** Шаг отмены по действию (решение 4): добавление и восстановление — удаление, удаление — восстановление, правка — «было». */
function stepOf(row: AuditRow): RevertStep {
  switch (row.action as UndoableAction) {
    case 'create':
    case 'restore':
      return { kind: 'delete' };
    case 'delete':
      return { kind: 'restore' };
    case 'update': {
      const before = diffOf(row).before;
      if (!before || typeof before !== 'object') throw unsupported();
      const fields: Record<string, unknown> = {};
      for (const key of INPUT_FIELDS) if (key in before) fields[key] = (before as Record<string, unknown>)[key];
      return { kind: 'fields', before: fields as Partial<OperationInput> };
    }
  }
}

export function createOperationUndoService(d: { db: Db; audit: AuditService; operations: OperationsService }): OperationUndoService {
  const { db, audit, operations: ops } = d;

  /** Запись, её операция и каскад после всех проверок (решение 7); ошибка — AppError. */
  async function cascade(ex: Executor, companyId: number, entryId: number): Promise<{ opId: number; rows: AuditRow[] }> {
    const entry = await first(ex.select().from(auditLog).where(and(eq(auditLog.id, entryId), eq(auditLog.companyId, companyId))));
    if (!entry) throw new AppError(404, 'NOT_FOUND', 'Запись истории не найдена');
    if (entry.entity !== 'operation' || entry.entityId === null || !(UNDOABLE_ACTIONS as readonly string[]).includes(entry.action)) throw unsupported();
    if (await first(ex.select({ id: auditUndo.auditId }).from(auditUndo).where(eq(auditUndo.auditId, entry.id)))) {
      throw new AppError(409, 'UNDO_DONE', 'Действие уже отменено');
    }
    const opId = entry.entityId;
    const op = await first(ex.select({ id: operations.id }).from(operations).where(and(eq(operations.id, opId), eq(operations.companyId, companyId))));
    if (!op) throw new AppError(404, 'NOT_FOUND', 'Операция больше не существует');
    const block = await undoBlock(ex, companyId, opId);
    if (block !== null && entry.id < block) throw unsupported('Операция удалена — сначала отмените её удаление');
    const found = await ex
      .select({ a: auditLog })
      .from(auditLog)
      .leftJoin(auditUndo, eq(auditUndo.auditId, auditLog.id))
      .where(
        and(
          eq(auditLog.companyId, companyId),
          eq(auditLog.entity, 'operation'),
          eq(auditLog.entityId, opId),
          gte(auditLog.id, entry.id),
          inArray(auditLog.action, [...UNDOABLE_ACTIONS]),
          isNull(auditUndo.auditId),
        ),
      )
      .orderBy(desc(auditLog.id));
    const rows = found.map((r) => r.a);
    assertCascadeSize(rows.length);
    return { opId, rows };
  }

  return {
    async preview(companyId, entryId) {
      await requireCompany(db, companyId);
      const { rows } = await cascade(db, companyId, entryId);
      const names = new Map(
        (
          await db
          .select({ id: users.id, name: users.name })
          .from(users)
            .where(inArray(users.id, [...new Set(rows.map((r) => r.userId).filter((x): x is number => x !== null))]))
        ).map((u) => [u.id, u.name]),
      );
      return {
        entries: rows.map((r) => ({
          id: r.id,
          action: r.action as UndoableAction,
          type: typeOf(r),
          at: r.at,
          userName: r.userId === null ? null : (names.get(r.userId) ?? null),
        })),
      };
    },

    async run(companyId, entryId, ids, userId) {
      await requireCompany(db, companyId, { writable: true });
      return withTx(
        db,
        async (tx) => {
          const { opId, rows } = await cascade(tx, companyId, entryId);
          // пока человек читал подтверждение, у операции появились или отменились действия (решение 6)
          const seen = [...new Set(ids)].sort((a, b) => a - b);
          const now = rows.map((r) => r.id).sort((a, b) => a - b);
          if (seen.length !== now.length || seen.some((x, i) => x !== now[i])) {
            throw new AppError(409, 'VERSION_CONFLICT', 'Действия с операцией изменились — обновите историю');
          }
          // шаги — вложенные mutate (точки сохранения): ошибка любого откатывает всю отмену
          for (const row of rows) await ops.revert(companyId, opId, stepOf(row), userId);
          const op = await ops.get(companyId, opId);
          const undone: UndoneAction[] = rows.map((r) => ({ id: r.id, action: r.action as UndoableAction, type: typeOf(r) }));
          const undoId = await audit.record({ companyId, userId, entity: 'operation', entityId: opId, action: 'undo', diff: { type: op.type, undone, deleted: op.deletedAt !== null } }, tx);
          for (const r of rows) await tx.insert(auditUndo).values({ auditId: r.id, undoId });
          return { undone: rows.map((r) => r.id), undoId, operation: { id: opId, deleted: op.deletedAt !== null } };
        },
        { behavior: 'immediate' },
      );
    },
  };
}
