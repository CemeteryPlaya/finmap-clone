import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { afterEach, describe, expect, it } from 'vitest';
import { openDb } from '../../src/server/db/client';
import { MIGRATIONS_DIR } from '../../src/server/db/migrate';
import { startServer } from '../../src/server/main';
import { createTestDb } from '../helpers/test-db';
import { testConfig } from '../helpers/test-app';

let cleanup: (() => void | Promise<void>) | null = null;
afterEach(async () => {
  await cleanup?.();
  cleanup = null;
});

describe('миграция 0001', () => {
  it('создаёт таблицы и уникальные индексы категорий', async () => {
    const t = await createTestDb();
    cleanup = t.cleanup;
    const s = t.sqlite!;
    s.prepare("INSERT INTO currencies (code,name,symbol,minor_units) VALUES ('KZT','Тенге','₸',2)").run();
    s.prepare("INSERT INTO companies (name, base_currency, created_at) VALUES ('ТОО', 'KZT', 'x')").run();
    const ins = s.prepare(
      "INSERT INTO categories (company_id, kind, parent_id, name, system_key, template_ref, order_index, created_at) VALUES (1, ?, NULL, ?, ?, ?, 0, 'x')",
    );
    ins.run('expense', 'Зарплата', 'salary', null);
    expect(() => ins.run('expense', 'Зарплата 2', 'salary', null)).toThrow(/UNIQUE/);
    ins.run('income', 'Доп', 'salary', null); // другой вид — допустимо на уровне БД
    ins.run('expense', 'Бар', null, 'computer-club:bar');
    expect(() => ins.run('expense', 'Бар 2', null, 'computer-club:bar')).toThrow(/UNIQUE/);
    ins.run('expense', 'Без ссылки 1', null, null);
    ins.run('expense', 'Без ссылки 2', null, null); // NULL не конфликтует
    expect(() =>
      s.prepare("INSERT INTO accounts (company_id, name, currency, starting_balance, opened_at, order_index, created_at) VALUES (1,'К','XXX',0,'2026-10-06',0,'x')").run(),
    ).toThrow(/FOREIGN KEY/);
  });

  it('при старте с БД на миграции 0000 делает бэкап перед миграцией', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fc-mig-'));
    cleanup = () => fs.rmSync(dir, { recursive: true, force: true });
    const config = testConfig(dir, { PORT: '0' });
    fs.mkdirSync(config.backupsDir, { recursive: true });

    // каталог миграций только с 0000
    const only0 = path.join(dir, 'migrations-0000');
    fs.cpSync(MIGRATIONS_DIR, only0, { recursive: true });
    const journalPath = path.join(only0, 'meta', '_journal.json');
    const journal = JSON.parse(fs.readFileSync(journalPath, 'utf8')) as { entries: unknown[] };
    journal.entries = journal.entries.slice(0, 1);
    fs.writeFileSync(journalPath, JSON.stringify(journal));
    {
      const { sqlite, db } = openDb(config.dbPath);
      migrate(db, { migrationsFolder: only0 });
      sqlite.close();
    }
    // свежий «вчерашний» бэкап, чтобы стартовый ensureRecent не создал ещё один
    const fresh = path.join(config.backupsDir, 'backup-20261005-120000.zip');
    fs.writeFileSync(fresh, 'x');

    const s = await startServer(config, { logger: false, handleSignals: false });
    try {
      const zips = fs.readdirSync(config.backupsDir).filter((f) => f.endsWith('.zip'));
      expect(zips.length).toBe(2); // fresh + pre-migration
      const res = await s.app.inject({ method: 'GET', url: '/api/v1/health' });
      expect(res.statusCode).toBe(200); // сервер поднялся на мигрированной БД
    } finally {
      await s.stop();
    }
  });
});
