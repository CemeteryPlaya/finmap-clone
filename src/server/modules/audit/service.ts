import { and, desc, eq, isNull, lt, type SQL } from 'drizzle-orm';
import type { Db } from '../../db/client';
import { auditLog } from '../../db/schema';

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
  entity: string;
  entityId: number | null;
  action: AuditAction;
  diff: Record<string, unknown> | null;
  at: string;
}

export interface AuditService {
  record(entry: AuditEntry): void;
  list(q: { companyId: number | null; limit?: number; beforeId?: number }): AuditRow[];
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
    record(entry) {
      db.insert(auditLog)
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
    list({ companyId, limit = 50, beforeId }) {
      const conds: SQL[] = [companyId === null ? isNull(auditLog.companyId) : eq(auditLog.companyId, companyId)];
      if (beforeId !== undefined) conds.push(lt(auditLog.id, beforeId));
      return db
        .select()
        .from(auditLog)
        .where(and(...conds))
        .orderBy(desc(auditLog.id))
        .limit(Math.min(limit, 200))
        .all()
        .map((r) => ({
          ...r,
          action: r.action as AuditAction,
          diff: r.diff ? (JSON.parse(r.diff) as Record<string, unknown>) : null,
        }));
    },
  };
}
