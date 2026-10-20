import { and, desc, eq, isNull, lt, sql, type AnyColumn, type SQL } from 'drizzle-orm';
import type { Db, Executor } from '../../db/client';
import { auditLog, auditUndo, operations, users } from '../../db/schema';

export type AuditAction =
  | 'create'
  | 'update'
  | 'delete'
  | 'restore'
  | 'archive'
  | 'unarchive'
  | 'reorder'
  /** «Вернуть по умолчанию» у настройки «Финансовых показателей» (§8.2 спецификации «Аналитика»). */
  | 'reset'
  | 'login'
  | 'logout'
  | 'password_change'
  /** Отмена действий с операцией (спецификация 2026-10-19, часть 2): diff — что отменено. */
  | 'undo';

/** Действия с операциями, которые отменяет «Отмена» в «Истории действий». */
export const UNDOABLE_ACTIONS = ['create', 'update', 'delete', 'restore'] as const;

export interface AuditEntry {
  companyId?: number | null;
  userId?: number | null;
  entity: string;
  entityId?: number | null;
  action: AuditAction;
  diff?: Record<string, unknown> | null;
}

export interface AuditRow {
  id: number;
  companyId: number | null;
  userId: number | null;
  /** Имя пользователя на момент чтения; null — системное событие или пользователь удалён. */
  userName: string | null;
  entity: string;
  entityId: number | null;
  action: AuditAction;
  diff: Record<string, unknown> | null;
  at: string;
  /** id записи «Отмена», которая отменила эту; null — не отменена. */
  undoneBy: number | null;
  /** Можно отменить (план 2026-10-20, решение 3 и R5). */
  undoable: boolean;
}

export interface AuditService {
  /** ex — транзакция изменения: запись истории откатится вместе с ним. Результат — id записи. */
  record(entry: AuditEntry, ex?: Executor): number;
  list(q: { companyId: number | null; limit?: number; beforeId?: number; userId?: number; entity?: string }): AuditRow[];
}

const SECRET_KEY = /password|hash|token|secret/i;

export function sanitizeDiff(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sanitizeDiff);
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) {
      if (SECRET_KEY.test(k)) continue;
      out[k] = sanitizeDiff(v);
    }
    return out;
  }
  return value;
}

/**
 * id последнего неотменённого «Удаления» операции (R5 плана 2026-10-20): пока операция удалена, раньше него отменять
 * нельзя. Аргументы — значения или колонки внешнего запроса (подзапрос коррелирует с ними).
 */
export function lastDeleteSql(companyId: number | AnyColumn, operationId: number | AnyColumn): SQL<number | null> {
  return sql<number | null>`(SELECT MAX(d.id) FROM audit_log d LEFT JOIN audit_undo u ON u.audit_id = d.id
    WHERE d.company_id = ${companyId} AND d.entity = 'operation' AND d.entity_id = ${operationId} AND d.action = 'delete' AND u.audit_id IS NULL)`;
}

/** Больше любого id: у удалённой операции без неотменённого «Удаления» отменять нечего. */
const NO_ID = Number.MAX_SAFE_INTEGER;

export function createAuditService(db: Db, now: () => Date = () => new Date()): AuditService {
  return {
    record(entry, ex) {
      return (ex ?? db)
        .insert(auditLog)
        .values({
          companyId: entry.companyId ?? null,
          userId: entry.userId ?? null,
          entity: entry.entity,
          entityId: entry.entityId ?? null,
          action: entry.action,
          diff: entry.diff ? JSON.stringify(sanitizeDiff(entry.diff)) : null,
          at: now().toISOString(),
        })
        .returning({ id: auditLog.id })
        .get().id;
    },
    list({ companyId, limit = 50, beforeId, userId, entity }) {
      const conds: SQL[] = [companyId === null ? isNull(auditLog.companyId) : eq(auditLog.companyId, companyId)];
      if (beforeId !== undefined) conds.push(lt(auditLog.id, beforeId));
      if (userId !== undefined) conds.push(eq(auditLog.userId, userId));
      if (entity !== undefined) conds.push(eq(auditLog.entity, entity));
      // отменить можно действие с операцией журнала: не отменённое, операция есть (не удалена жёстко), а у удалённой —
      // не раньше её последнего неотменённого «Удаления» (решение 3, R5)
      const actions = sql.join(
        UNDOABLE_ACTIONS.map((a) => sql`${a}`),
        sql`, `,
      );
      const undoable = sql<number>`CASE WHEN ${auditLog.entity} = 'operation' AND ${auditLog.action} IN (${actions})
        AND ${auditUndo.undoId} IS NULL AND ${operations.id} IS NOT NULL
        AND (${operations.deletedAt} IS NULL OR ${auditLog.id} >= COALESCE(${lastDeleteSql(auditLog.companyId, auditLog.entityId)}, ${NO_ID}))
        THEN 1 ELSE 0 END`;
      return db
        .select({ a: auditLog, userName: users.name, undoneBy: auditUndo.undoId, undoable })
        .from(auditLog)
        .leftJoin(users, eq(users.id, auditLog.userId))
        .leftJoin(auditUndo, eq(auditUndo.auditId, auditLog.id))
        .leftJoin(operations, and(eq(auditLog.entity, 'operation'), eq(operations.id, auditLog.entityId), eq(operations.companyId, auditLog.companyId)))
        .where(and(...conds))
        .orderBy(desc(auditLog.id))
        .limit(Math.min(Math.max(limit, 1), 200))
        .all()
        .map(({ a, userName, undoneBy, undoable }) => ({
          ...a,
          userName: userName ?? null,
          undoneBy: undoneBy ?? null,
          undoable: undoable === 1,
          action: a.action as AuditAction,
          diff: a.diff ? (JSON.parse(a.diff) as Record<string, unknown>) : null,
        }));
    },
  };
}
