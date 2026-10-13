import { and, desc, eq, inArray, lt, sql, type SQL } from 'drizzle-orm';
import { alias } from 'drizzle-orm/sqlite-core';
import type { ImportCounts, ImportListItem, ImportListPage, ImportListQuery, ImportPending } from '../../../shared/schemas/imports';
import type { Executor } from '../../db/client';
import { imports, operations, users } from '../../db/schema';

/**
 * Изменённая после импорта операция (§7.3 спецификации импорта): неудалённая, у которой version > 1 (правка, «Указать»,
 * массовое действие, удаление и восстановление) или есть вложение — любое, в том числе удалённое. Условие — для запроса
 * FROM operations без псевдонима.
 */
export const EDITED_SQL = sql`(operations.deleted_at IS NULL AND (operations.version > 1 OR EXISTS (SELECT 1 FROM attachments a WHERE a.operation_id = operations.id)))`;

/** Не больше id в одном IN (…): предел переменных SQLite — 32 766, импорт — до 50 000 операций. */
export const IN_CHUNK = 500;

/** Части списка id по IN_CHUNK. */
export function chunks<T>(items: readonly T[], size = IN_CHUNK): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

/** Операции импортов, которые удалит отмена: всего и изменённых после импорта; импорта без операций в ответе нет. */
export function pendingCounts(ex: Executor, importIds: readonly number[]): Map<number, ImportPending> {
  const out = new Map<number, ImportPending>();
  for (const part of chunks(importIds)) {
    const rows = ex
      .select({
        importId: operations.importId,
        operations: sql<number>`count(*)`,
        edited: sql<number>`coalesce(sum(CASE WHEN ${EDITED_SQL} THEN 1 ELSE 0 END), 0)`,
      })
      .from(operations)
      .where(inArray(operations.importId, part))
      .groupBy(operations.importId)
      .all();
    for (const r of rows) if (r.importId !== null) out.set(r.importId, { operations: r.operations, edited: r.edited });
  }
  return out;
}

type ImportRow = typeof imports.$inferSelect;

function toItem(row: ImportRow, userName: string | null, undoneByName: string | null, pending: ImportPending | null): ImportListItem {
  return {
    id: row.id,
    fileName: row.fileName,
    fileSize: row.fileSize,
    status: row.status,
    createdAt: row.createdAt,
    userName,
    counts: JSON.parse(row.counts) as ImportCounts,
    undoneAt: row.undoneAt,
    undoneByName,
    pending: row.status === 'done' ? (pending ?? { operations: 0, edited: 0 }) : null,
  };
}

/** Записи импортов компании с именами пользователей и pending у неотменённых; новые сверху. */
function select(ex: Executor, conds: SQL[], limit: number): ImportListItem[] {
  const undoneBy = alias(users, 'undone_by_user');
  const rows = ex
    .select({ i: imports, userName: users.name, undoneByName: undoneBy.name })
    .from(imports)
    .leftJoin(users, eq(users.id, imports.userId))
    .leftJoin(undoneBy, eq(undoneBy.id, imports.undoneBy))
    .where(and(...conds))
    .orderBy(desc(imports.id))
    .limit(limit)
    .all();
  const pending = pendingCounts(
    ex,
    rows.filter((r) => r.i.status === 'done').map((r) => r.i.id),
  );
  return rows.map((r) => toItem(r.i, r.userName ?? null, r.undoneByName ?? null, pending.get(r.i.id) ?? null));
}

/** Список «Импорты» (§7.2): страница по beforeId; nextBeforeId — id последней записи полной страницы. */
export function listImports(ex: Executor, companyId: number, q: ImportListQuery): ImportListPage {
  const conds: SQL[] = [eq(imports.companyId, companyId)];
  if (q.beforeId !== undefined) conds.push(lt(imports.id, q.beforeId));
  const items = select(ex, conds, q.limit);
  const last = items.at(-1);
  return { items, nextBeforeId: items.length === q.limit && last ? last.id : null };
}

/** Одна запись импорта компании; null — нет такой. */
export function importItem(ex: Executor, companyId: number, id: number): ImportListItem | null {
  return select(ex, [eq(imports.companyId, companyId), eq(imports.id, id)], 1)[0] ?? null;
}
