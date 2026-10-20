import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import Database from 'better-sqlite3';
import { getTableColumns, sql } from 'drizzle-orm';
import { getTableConfig, type SQLiteTable } from 'drizzle-orm/sqlite-core';
import type { Db, OpenedDatabase } from '../../src/server/db/client';
import { one } from '../../src/server/db/raw';
import { sqliteTables } from '../../src/server/db/schema';
import type { FileStore } from '../../src/server/files/store';
import { DUMP_FORMAT, restoreDatabase } from '../../src/server/modules/backup/dump';

type Row = Record<string, unknown>;

export interface TransferReport {
  tables: { name: string; source: number; target: number }[];
  sums: { amount: [number, number]; baseAmount: [number, number] };
  ok: boolean;
}

/**
 * Выгрузка файла SQLite в формате backup/dump.ts без привязки процесса к SQLite (процесс переноса привязан к Postgres):
 * строки читает better-sqlite3, значения переводятся колонками SQLite-схемы (булевы из 0/1 и т. п.), как их отдал бы Drizzle.
 */
export function dumpSqliteFile(file: string, now = new Date()): { dump: Buffer; counts: Record<string, number>; sums: { amount: number; baseAmount: number } } {
  const db = new Database(file, { readonly: true, fileMustExist: true });
  try {
    const tables: Record<string, Row[]> = {};
    const counts: Record<string, number> = {};
    for (const [key, table] of Object.entries(sqliteTables)) {
      const name = getTableConfig(table as SQLiteTable).name;
      const columns = Object.entries(getTableColumns(table as SQLiteTable));
      const raw = db.prepare(`SELECT * FROM "${name}"`).all() as Row[];
      tables[key] = raw.map((r) => Object.fromEntries(columns.map(([prop, col]) => [prop, r[col.name] === null || r[col.name] === undefined ? null : col.mapFromDriverValue(r[col.name])])));
      counts[name] = raw.length;
    }
    const sums = db.prepare('SELECT COALESCE(SUM(amount), 0) AS amount, COALESCE(SUM(base_amount), 0) AS baseAmount FROM operations').get() as { amount: number; baseAmount: number };
    const dump = zlib.gzipSync(JSON.stringify({ format: DUMP_FORMAT, version: 1, createdAt: now.toISOString(), tables }));
    return { dump, counts, sums };
  } finally {
    db.close();
  }
}

/** Число строк каждой таблицы базы (по именам таблиц). */
export async function tableCounts(db: Db): Promise<Record<string, number>> {
  const out: Record<string, number> = {};
  for (const table of Object.values(sqliteTables)) {
    const name = getTableConfig(table as SQLiteTable).name;
    out[name] = Number((await one<{ n: number }>(db, sql`SELECT COUNT(*) AS n FROM ${sql.identifier(name)}`))!.n);
  }
  return out;
}

/**
 * Перенос базы SQLite в размеченную базу Postgres (план 2026-10-20-vercel-postgres, задача 17): все таблицы одной
 * транзакцией в порядке внешних ключей, счётчики id сдвигаются; в непустую базу — отказ без записи (force — замена).
 * Возвращает сверку: строки по таблицам и суммы операций до и после.
 */
export async function transferSqliteToPg(file: string, target: OpenedDatabase, opts: { force?: boolean } = {}): Promise<TransferReport> {
  const src = dumpSqliteFile(file);
  await restoreDatabase(target.db, src.dump, { force: opts.force });
  const after = await tableCounts(target.db);
  const s = (await one<{ amount: number; baseAmount: number }>(target.db, sql`SELECT COALESCE(SUM(amount), 0) AS amount, COALESCE(SUM(base_amount), 0) AS "baseAmount" FROM operations`))!;
  const tables = Object.keys(src.counts).map((name) => ({ name, source: src.counts[name]!, target: after[name] ?? 0 }));
  const sums = { amount: [src.sums.amount, Number(s.amount)] as [number, number], baseAmount: [src.sums.baseAmount, Number(s.baseAmount)] as [number, number] };
  return { tables, sums, ok: tables.every((t) => t.source === t.target) && sums.amount[0] === sums.amount[1] && sums.baseAmount[0] === sums.baseAmount[1] };
}

/** Вложения из папки uploads (файлы `<uuid>.<расширение>`) — в хранилище под теми же ключами, что в attachments.stored_name. */
export async function copyUploads(dir: string, store: FileStore): Promise<{ files: number; bytes: number }> {
  let files = 0;
  let bytes = 0;
  if (!fs.existsSync(dir)) return { files, bytes };
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (!entry.isFile()) continue;
    const data = fs.readFileSync(path.join(dir, entry.name));
    await store.put(entry.name, data, 'application/octet-stream');
    files++;
    bytes += data.length;
  }
  return { files, bytes };
}
