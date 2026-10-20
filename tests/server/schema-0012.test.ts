import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { afterEach, describe, expect, it } from 'vitest';
import { openDb } from '../../src/server/db/client';
import { MIGRATIONS_DIR, runMigrations } from '../../src/server/db/migrate';

let dir = '';
afterEach(() => {
  if (dir) fs.rmSync(dir, { recursive: true, force: true });
  dir = '';
});

describe('миграция 0012 (порядок состава комплекта, план 2026-10-20-vercel-postgres)', () => {
  it('position переносит прежний порядок ввода (rowid) внутри каждого комплекта', () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fc-mig12-'));
    // миграции до 0011 включительно — копия каталога с укороченным журналом
    const upTo11 = path.join(dir, 'migrations');
    fs.cpSync(MIGRATIONS_DIR, upTo11, { recursive: true });
    const journalPath = path.join(upTo11, 'meta', '_journal.json');
    const journal = JSON.parse(fs.readFileSync(journalPath, 'utf8')) as { entries: { tag: string }[] };
    expect(journal.entries[12]!.tag).toMatch(/^0012_/);
    journal.entries = journal.entries.slice(0, 12);
    fs.writeFileSync(journalPath, JSON.stringify(journal));

    const { db, sqlite } = openDb(path.join(dir, 'app.db'));
    migrate(db, { migrationsFolder: upTo11 });
    sqlite.exec(`
      INSERT INTO users (id, login, name, password_hash, created_at) VALUES (1, 'a', 'А', 'x', 'x');
      INSERT INTO currencies (code, name, symbol, minor_units) VALUES ('KZT', 'Тенге', '₸', 2);
      INSERT INTO companies (id, name, base_currency, created_at) VALUES (1, 'К', 'KZT', 'x');
      INSERT INTO stock_items (id, company_id, name, name_key, unit, sale_price, is_combo, created_at) VALUES
        (1, 1, 'A', 'a', 'pcs', 0, 0, 'x'), (2, 1, 'B', 'b', 'pcs', 0, 0, 'x'), (3, 1, 'C', 'c', 'pcs', 0, 0, 'x'),
        (10, 1, 'K1', 'k1', 'pcs', 0, 1, 'x'), (11, 1, 'K2', 'k2', 'pcs', 0, 1, 'x');
      INSERT INTO stock_combo_parts (combo_id, item_id, qty) VALUES (10, 3, 1000), (11, 2, 1000), (10, 1, 1000), (10, 2, 1000), (11, 1, 1000);
    `);
    runMigrations(db);
    const parts = sqlite.prepare('SELECT combo_id c, item_id i, position p FROM stock_combo_parts ORDER BY combo_id, position').all();
    expect(parts).toEqual([
      { c: 10, i: 3, p: 0 },
      { c: 10, i: 1, p: 1 },
      { c: 10, i: 2, p: 2 },
      { c: 11, i: 2, p: 0 },
      { c: 11, i: 1, p: 1 },
    ]);
    sqlite.close();
  });
});
