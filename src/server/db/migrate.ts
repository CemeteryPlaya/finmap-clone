import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import type { Db, OpenedDatabase, Sqlite } from './client';
import { driverOf } from './tx';

export const MIGRATIONS_DIR = fileURLToPath(new URL('./migrations', import.meta.url));
/** Миграции Postgres (drizzle.pg.config.ts). */
export const PG_MIGRATIONS_DIR = fileURLToPath(new URL('./migrations-pg', import.meta.url));

export function runMigrations(db: Db): void {
  migrate(db, { migrationsFolder: MIGRATIONS_DIR });
}

/** Миграции открытой базы по её диалекту. */
export async function migrateDatabase(o: OpenedDatabase): Promise<void> {
  if (o.dialect === 'sqlite') return runMigrations(o.db);
  if (driverOf(o.db) === 'pglite') {
    const { migrate: migratePglite } = await import('drizzle-orm/pglite/migrator');
    await migratePglite(o.db as never, { migrationsFolder: PG_MIGRATIONS_DIR });
    return;
  }
  const { migrate: migrateNeon } = await import('drizzle-orm/neon-serverless/migrator');
  await migrateNeon(o.db as never, { migrationsFolder: PG_MIGRATIONS_DIR });
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
