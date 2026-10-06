import Database from 'better-sqlite3';
import { drizzle, type BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import * as schema from './schema';

export type Sqlite = Database.Database;
export type Db = BetterSQLite3Database<typeof schema>;

/** База или транзакция Drizzle — сервисы принимают любое, чтобы работать внутри общей транзакции. */
export type Executor = Db | Parameters<Parameters<Db['transaction']>[0]>[0];

export function ulower(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  return String(value).toLocaleLowerCase('ru').replaceAll('ё', 'е');
}

export function openDb(filePath: string): { sqlite: Sqlite; db: Db } {
  const sqlite = new Database(filePath);
  try {
    sqlite.pragma('journal_mode = WAL');
    sqlite.pragma('foreign_keys = ON');
    sqlite.pragma('busy_timeout = 5000');
    sqlite.function('ulower', { deterministic: true }, (v: unknown) => ulower(v));
    const db = drizzle({ client: sqlite, schema });
    return { sqlite, db };
  } catch (e) {
    sqlite.close(); // не оставляем открытый дескриптор (файл не SQLite и т. п.)
    throw e;
  }
}
