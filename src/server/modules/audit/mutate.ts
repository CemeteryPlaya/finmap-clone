import type { Db, Executor } from '../../db/client';
import type { AuditEntry, AuditService } from './service';

/** Изменение справочника и запись в историю — одной транзакцией: либо оба, либо ничего. */
export function mutate<T>(db: Db, audit: AuditService, fn: (tx: Executor, record: (entry: AuditEntry) => void) => T): T {
  return db.transaction((tx) => fn(tx, (entry) => audit.record(entry, tx)));
}

/** Только реально изменившиеся поля; null — изменений нет (пустой PATCH не пишет историю). */
export function changedFields<T extends object>(before: T, patch: Partial<T>): { before: Partial<T>; after: Partial<T> } | null {
  const b: Partial<T> = {};
  const a: Partial<T> = {};
  for (const key of Object.keys(patch) as (keyof T)[]) {
    const next = patch[key];
    if (next === undefined) continue;
    if (JSON.stringify(before[key]) === JSON.stringify(next)) continue;
    b[key] = before[key];
    a[key] = next;
  }
  return Object.keys(a).length > 0 ? { before: b, after: a } : null;
}
