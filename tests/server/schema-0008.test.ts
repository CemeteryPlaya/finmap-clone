import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { afterEach, describe, expect, it } from 'vitest';
import { openDb } from '../../src/server/db/client';
import { MIGRATIONS_DIR } from '../../src/server/db/migrate';

let dir = '';
afterEach(() => {
  if (dir) fs.rmSync(dir, { recursive: true, force: true });
  dir = '';
});

const insertDoc =
  "INSERT INTO stock_docs (company_id, type, number, at, warehouse_id, source, source_ref, created_by, created_at, updated_at, version) VALUES (?, 'sale', ?, '2026-10-01T10:00:00.000Z', ?, 'senet', ?, 1, 'x', 'x', 1)";

describe('миграция 0008 (итоговая правка склада)', () => {
  it('на БД с данными склада после 0007: индекс по source_batch_id и уникальность источника в пределах компании', () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fc-mig8-'));
    const upTo0007 = path.join(dir, 'migrations-0007');
    fs.cpSync(MIGRATIONS_DIR, upTo0007, { recursive: true });
    const journalPath = path.join(upTo0007, 'meta', '_journal.json');
    const journal = JSON.parse(fs.readFileSync(journalPath, 'utf8')) as { entries: { tag: string }[] };
    expect(journal.entries[8]!.tag).toMatch(/^0008_/);
    journal.entries = journal.entries.slice(0, 8);
    fs.writeFileSync(journalPath, JSON.stringify(journal));

    const { db, sqlite } = openDb(path.join(dir, 'app.db'));
    migrate(db, { migrationsFolder: upTo0007 });
    const indexes = (table: string) => (sqlite.prepare(`PRAGMA index_list('${table}')`).all() as { name: string }[]).map((i) => i.name);
    expect(indexes('stock_batches')).not.toContain('stock_batches_source_idx');

    sqlite.prepare("INSERT INTO currencies (code,name,symbol,minor_units) VALUES ('KZT','Тенге','₸',2)").run();
    sqlite.prepare("INSERT INTO users (login, name, password_hash, created_at) VALUES ('u','U','h','x')").run();
    for (const n of ['ТОО 1', 'ТОО 2']) sqlite.prepare("INSERT INTO companies (name, base_currency, created_at) VALUES (?, 'KZT', 'x')").run(n);
    for (const [cid, n] of [[1, 'Клуб 1'], [2, 'Клуб 2']] as const) {
      sqlite.prepare("INSERT INTO projects (company_id, name, template_key, template_params, order_index, created_at) VALUES (?, ?, 'blank', '{}', 0, 'x')").run(cid, n);
      sqlite.prepare("INSERT INTO stock_warehouses (company_id, project_id, name, created_at) VALUES (?, ?, 'Бар', 'x')").run(cid, cid);
    }
    sqlite.prepare(insertDoc).run(1, 'Р-0001', 1, '12345');
    // до 0008 источник уникален глобально
    expect(() => sqlite.prepare(insertDoc).run(2, 'Р-0001', 2, '12345')).toThrow(/UNIQUE/);

    migrate(db, { migrationsFolder: MIGRATIONS_DIR });
    expect(indexes('stock_batches')).toContain('stock_batches_source_idx');
    expect(indexes('stock_docs')).toContain('stock_docs_source_uq');
    const uq = sqlite.prepare("PRAGMA index_info('stock_docs_source_uq')").all() as { name: string }[];
    expect(uq.map((c) => c.name)).toEqual(['company_id', 'source', 'source_ref']);

    // существующие данные сохранены; другая компания может иметь тот же источник, та же компания — нет
    expect((sqlite.prepare('SELECT COUNT(*) n FROM stock_docs').get() as { n: number }).n).toBe(1);
    expect(sqlite.prepare(insertDoc).run(2, 'Р-0001', 2, '12345').changes).toBe(1);
    expect(() => sqlite.prepare(insertDoc).run(1, 'Р-0002', 1, '12345')).toThrow(/UNIQUE/);
    sqlite.close();
  });
});
