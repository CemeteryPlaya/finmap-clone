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
