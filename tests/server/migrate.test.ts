import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { afterEach, describe, expect, it } from 'vitest';
import { openDb } from '../../src/server/db/client';
import { appliedMigrationsCount, codeMigrationsCount, migrateWithBackup, MIGRATIONS_DIR } from '../../src/server/db/migrate';

let dir = '';
afterEach(() => {
  if (dir) fs.rmSync(dir, { recursive: true, force: true });
  dir = '';
});

function fakeBackup() {
  const calls: string[] = [];
  return { calls, backup: { create: (reason: 'pre-migration') => void calls.push(reason) } };
}

describe('migrateWithBackup', () => {
  it('новая БД и актуальная БД — без бэкапа; отстающая — бэкап, затем миграции', () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fc-migwb-'));

    const fresh = openDb(path.join(dir, 'fresh.db'));
    const f = fakeBackup();
    migrateWithBackup({ db: fresh.db, sqlite: fresh.sqlite, dbExisted: false, backup: f.backup });
    expect(f.calls).toEqual([]);
    migrateWithBackup({ db: fresh.db, sqlite: fresh.sqlite, dbExisted: true, backup: f.backup });
    expect(f.calls).toEqual([]);
    fresh.sqlite.close();

    const only0 = path.join(dir, 'migrations-0000');
    fs.cpSync(MIGRATIONS_DIR, only0, { recursive: true });
    const journalPath = path.join(only0, 'meta', '_journal.json');
    const journal = JSON.parse(fs.readFileSync(journalPath, 'utf8')) as { entries: unknown[] };
    journal.entries = journal.entries.slice(0, 1);
    fs.writeFileSync(journalPath, JSON.stringify(journal));
    const old = openDb(path.join(dir, 'old.db'));
    migrate(old.db, { migrationsFolder: only0 });
    const o = fakeBackup();
    migrateWithBackup({ db: old.db, sqlite: old.sqlite, dbExisted: true, backup: o.backup });
    expect(o.calls).toEqual(['pre-migration']);
    expect(appliedMigrationsCount(old.sqlite)).toBe(codeMigrationsCount());
    old.sqlite.close();
  });
});
