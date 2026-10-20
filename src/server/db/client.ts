import Database from 'better-sqlite3';
import { drizzle, type BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import { foldCase } from '../../shared/search';
import type { DbConfig } from '../config';
import { bindSchema, pgTables, sqliteTables, type Dialect } from './schema';
import { ambient } from './tx';

export type Sqlite = Database.Database;
export type Db = BetterSQLite3Database<typeof sqliteTables>;

/** База или транзакция Drizzle — сервисы принимают любое, чтобы работать внутри общей транзакции. */
export type Executor = Db | Parameters<Parameters<Db['transaction']>[0]>[0];

export function ulower(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  return foldCase(String(value));
}

export function openDb(filePath: string): { sqlite: Sqlite; db: Db } {
  const sqlite = new Database(filePath);
  try {
    sqlite.pragma('journal_mode = WAL');
    sqlite.pragma('foreign_keys = ON');
    sqlite.pragma('busy_timeout = 5000');
    sqlite.function('ulower', { deterministic: true }, (v: unknown) => ulower(v));
    // окружающая база: запросы вне транзакции встают в очередь соединения, внутри — идут в транзакцию (db/tx.ts)
    const db = ambient(drizzle({ client: sqlite, schema: sqliteTables }));
    return { sqlite, db };
  } catch (e) {
    sqlite.close(); // не оставляем открытый дескриптор (файл не SQLite и т. п.)
    throw e;
  }
}

export interface OpenedDatabase {
  /** Окружающая база для сервисов (db/tx.ts). По типам — база SQLite: таблицы и построитель у диалектов общие (Р3). */
  db: Db;
  dialect: Dialect;
  /** Соединение better-sqlite3 — только у SQLite (бэкап копией файла, быстрая запись импорта). */
  sqlite: Sqlite | null;
  close(): Promise<void>;
}

/** int8 и numeric — числами: суммы в тиынах меньше 2^53 (Р5); без этого SUM и COUNT пришли бы строками. */
const toNumber = (v: string) => Number(v);

/** База по конфигу (Р1): файл SQLite, Postgres в памяти процесса (PGlite, тесты) или Neon. Привязывает схему процесса. */
export async function openDatabase(cfg: DbConfig): Promise<OpenedDatabase> {
  if (cfg.kind === 'sqlite') {
    bindSchema('sqlite');
    const { sqlite, db } = openDb(cfg.path);
    return {
      db,
      sqlite,
      dialect: 'sqlite',
      close: async () => {
        sqlite.close();
      },
    };
  }
  bindSchema('pg');
  if (cfg.kind === 'pglite') {
    const { PGlite } = await import('@electric-sql/pglite');
    const { drizzle: pglite } = await import('drizzle-orm/pglite');
    const client = await PGlite.create(cfg.dataDir, { parsers: { 20: toNumber, 1700: toNumber } });
    const db = ambient(pglite({ client, schema: pgTables }) as unknown as Db, 'pglite');
    return { db, sqlite: null, dialect: 'pg', close: () => client.close() };
  }
  const { Pool, neonConfig, types } = await import('@neondatabase/serverless');
  const { drizzle: neon } = await import('drizzle-orm/neon-serverless');
  const { default: ws } = await import('ws');
  neonConfig.webSocketConstructor = ws;
  types.setTypeParser(20, toNumber);
  types.setTypeParser(1700, toNumber);
  const pool = new Pool({ connectionString: cfg.url });
  const db = ambient(neon({ client: pool, schema: pgTables }) as unknown as Db, 'pool');
  return { db, sqlite: null, dialect: 'pg', close: () => pool.end() };
}
