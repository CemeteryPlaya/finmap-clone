import { and, desc, eq, isNull, lt, type SQL } from 'drizzle-orm';
import type { Db, Executor } from '../../db/client';
import { auditLog, users } from '../../db/schema';

export type AuditAction =
  | 'create'
  | 'update'
  | 'delete'
  | 'restore'
  | 'archive'
  | 'unarchive'
  | 'reorder'
  | 'login'
  | 'logout'
  | 'password_change';

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
}

export interface AuditService {
  /** ex — транзакция изменения: запись истории откатится вместе с ним. */
  record(entry: AuditEntry, ex?: Executor): void;
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

export function createAuditService(db: Db, now: () => Date = () => new Date()): AuditService {
  return {
    record(entry, ex) {
      (ex ?? db)
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
        .run();
    },
    list({ companyId, limit = 50, beforeId, userId, entity }) {
      const conds: SQL[] = [companyId === null ? isNull(auditLog.companyId) : eq(auditLog.companyId, companyId)];
      if (beforeId !== undefined) conds.push(lt(auditLog.id, beforeId));
      if (userId !== undefined) conds.push(eq(auditLog.userId, userId));
      if (entity !== undefined) conds.push(eq(auditLog.entity, entity));
      return db
        .select({ a: auditLog, userName: users.name })
        .from(auditLog)
        .leftJoin(users, eq(users.id, auditLog.userId))
        .where(and(...conds))
        .orderBy(desc(auditLog.id))
        .limit(Math.min(Math.max(limit, 1), 200))
        .all()
        .map(({ a, userName }) => ({
          ...a,
          userName: userName ?? null,
          action: a.action as AuditAction,
          diff: a.diff ? (JSON.parse(a.diff) as Record<string, unknown>) : null,
        }));
    },
  };
}
