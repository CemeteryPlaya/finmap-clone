import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import type { Db, Sqlite } from './client';

export const MIGRATIONS_DIR = fileURLToPath(new URL('./migrations', import.meta.url));

export function runMigrations(db: Db): void {
  migrate(db, { migrationsFolder: MIGRATIONS_DIR });
}

export function codeMigrationsCount(): number {
  const journal = JSON.parse(fs.readFileSync(path.join(MIGRATIONS_DIR, 'meta', '_journal.json'), 'utf8')) as {
    entries: unknown[];
  };
  return journal.entries.length;
}

export function appliedMigrationsCount(sqlite: Sqlite): number {
  const table = sqlite
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = '__drizzle_migrations'")
    .get();
  if (!table) return 0;
  return (sqlite.prepare('SELECT COUNT(*) AS n FROM __drizzle_migrations').get() as { n: number }).n;
}

/**
 * Миграции с бэкапом перед ними, если существующая БД отстаёт от кода (§9.2).
 * Общая точка для startServer и скриптов setup / user:add.
 */
export function migrateWithBackup(d: {
  db: Db;
  sqlite: Sqlite;
  dbExisted: boolean;
  backup: { create(reason: 'pre-migration'): unknown };
}): void {
  const applied = appliedMigrationsCount(d.sqlite);
  if (d.dbExisted && applied > 0 && applied < codeMigrationsCount()) d.backup.create('pre-migration');
  runMigrations(d.db);
}
