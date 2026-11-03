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

/** Миграция 0015 (план 2026-11-03-club-analytics-1, задача 1; решения R1, R2): отрезки забора Senet и их заполнение по senet_raw. */
describe('миграция 0015 (покрытие данных Senet)', () => {
  it('создаёт senet_data_spans с индексом и переносит отрезки сырых файлов клубов', () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fc-mig15-'));
    const upTo0014 = path.join(dir, 'migrations-0014');
    fs.cpSync(MIGRATIONS_DIR, upTo0014, { recursive: true });
    const journalPath = path.join(upTo0014, 'meta', '_journal.json');
    const journal = JSON.parse(fs.readFileSync(journalPath, 'utf8')) as { entries: { tag: string }[] };
    expect(journal.entries[15]!.tag).toBe('0015_senet_data_spans');
    journal.entries = journal.entries.slice(0, 15);
    fs.writeFileSync(journalPath, JSON.stringify(journal));

    const { db, sqlite } = openDb(path.join(dir, 'app.db'));
    migrate(db, { migrationsFolder: upTo0014 });
    sqlite.prepare("INSERT INTO currencies (code,name,symbol,minor_units) VALUES ('KZT','Тенге','₸',2)").run();
    sqlite.prepare("INSERT INTO users (login, name, password_hash, created_at) VALUES ('u','U','h','x')").run();
    sqlite.prepare("INSERT INTO companies (name, base_currency, created_at) VALUES ('ТОО', 'KZT', 'x')").run();
    sqlite
      .prepare("INSERT INTO senet_connections (company_id, name, org, auth_method, credentials_secret, credentials_hint, created_at, created_by) VALUES (1, 'К', 'club-demo', 'password', 's', 'h', 'x', 1)")
      .run();
    sqlite.prepare('INSERT INTO senet_offices (connection_id, senet_office_id) VALUES (1, 1)').run();
    const raw = sqlite.prepare("INSERT INTO senet_raw (connection_id, report, office_id, from_date, to_date, fetched_at, status, file_key, sha256) VALUES (1, ?, ?, ?, ?, 'x', 200, ?, ?)");
    raw.run('load', 1, '2026-11-01T00:00:00.000Z', '2026-11-02T00:00:00.000Z', 'k1', 'a');
    raw.run('transactions', 1, '2026-11-01T00:00:00.000Z', '2026-11-03T00:00:00.000Z', 'k2', 'b');
    // файл подключения без клуба (проверка входа) — не отрезок клуба
    raw.run('sessions', null, '2026-11-01T00:00:00.000Z', '2026-11-02T00:00:00.000Z', 'k3', 'c');

    migrate(db, { migrationsFolder: MIGRATIONS_DIR });
    const cols = (sqlite.prepare('PRAGMA table_info(senet_data_spans)').all() as { name: string }[]).map((c) => c.name);
    expect(cols).toEqual(['id', 'office_id', 'report', 'from_at', 'to_at']);
    const indexes = (sqlite.prepare("PRAGMA index_list('senet_data_spans')").all() as { name: string }[]).map((i) => i.name);
    expect(indexes).toContain('senet_data_spans_office_report_idx');
    expect(sqlite.prepare('SELECT office_id, report, from_at, to_at FROM senet_data_spans ORDER BY report').all()).toEqual([
      { office_id: 1, report: 'load', from_at: '2026-11-01T00:00:00.000Z', to_at: '2026-11-02T00:00:00.000Z' },
      { office_id: 1, report: 'transactions', from_at: '2026-11-01T00:00:00.000Z', to_at: '2026-11-03T00:00:00.000Z' },
    ]);
    sqlite.close();
  });
});
