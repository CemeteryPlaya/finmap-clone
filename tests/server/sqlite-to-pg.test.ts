import { spawnSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';
import { afterEach, describe, expect, it } from 'vitest';
import { copyUploads, tableCounts, transferSqliteToPg } from '../../scripts/lib/sqlite-to-pg';
import { buildApp } from '../../src/server/app';
import { openDatabase, type OpenedDatabase } from '../../src/server/db/client';
import { migrateDatabase } from '../../src/server/db/migrate';
import { apiReport } from '../helpers/api-report';
import { testConfig } from '../helpers/test-app';
import { memoryStore } from '../helpers/vercel';

/**
 * Перенос базы SQLite в Postgres (план 2026-10-20-vercel-postgres, задача 17). Только проект server-pg: SQLite-сторона
 * (демо-набор и ответы её API) готовится в отдельном процессе — процесс привязан к одному диалекту.
 */

let dir = '';
let target: OpenedDatabase | null = null;
afterEach(async () => {
  await target?.close();
  target = null;
  if (dir) fs.rmSync(dir, { recursive: true, force: true });
  dir = '';
});

/** База SQLite с демо-набором и ответы её API (балансы, «Прибыль»). */
function sqliteDemo(password: string): { dbFile: string; report: Record<string, unknown> } {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fc-to-pg-'));
  const reportFile = path.join(dir, 'report.json');
  const child = spawnSync(process.execPath, [path.resolve('node_modules/tsx/dist/cli.mjs'), 'tests/helpers/sqlite-demo.ts', dir, reportFile], {
    env: { ...process.env, REPORT_PASSWORD: password, TEST_DB: 'sqlite' },
    encoding: 'utf8',
    timeout: 120_000,
  });
  if (child.status !== 0) throw new Error(`Демо-база SQLite не создана: ${child.stderr || child.stdout}`);
  return { dbFile: path.join(dir, 'app.db'), report: JSON.parse(fs.readFileSync(reportFile, 'utf8')) as Record<string, unknown> };
}

/** Число строк каждой таблицы файла SQLite (без служебных). */
function sqliteCounts(file: string): Record<string, number> {
  const db = new Database(file, { readonly: true });
  try {
    const names = (db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '__drizzle%'").all() as { name: string }[]).map(
      (r) => r.name,
    );
    return Object.fromEntries(names.map((n) => [n, (db.prepare(`SELECT COUNT(*) AS n FROM "${n}"`).get() as { n: number }).n]));
  } finally {
    db.close();
  }
}

describe.runIf(process.env.TEST_DB === 'pg')('db:to-pg', () => {
  it('демо-набор: строки всех таблиц, суммы операций и ответы API совпадают; повтор в непустую базу — отказ без записи', async () => {
    const password = crypto.randomBytes(12).toString('hex');
    const { dbFile, report } = sqliteDemo(password);
    target = await openDatabase({ kind: 'pglite' });
    await migrateDatabase(target);

    const result = await transferSqliteToPg(dbFile, target);
    expect(result.ok).toBe(true);
    const counts = sqliteCounts(dbFile);
    expect(Object.fromEntries(result.tables.map((t) => [t.name, t.target]))).toEqual(counts);
    expect(result.tables.every((t) => t.source === t.target)).toBe(true);
    expect(counts.operations).toBeGreaterThan(100);
    expect(result.sums.amount[0]).toBe(result.sums.amount[1]);
    expect(result.sums.baseAmount[0]).toBe(result.sums.baseAmount[1]);
    expect(result.sums.amount[0]).toBeGreaterThan(0);

    const app = await buildApp({ config: testConfig(dir), db: target.db, sqlite: null, logger: false, now: () => new Date('2026-10-06T12:00:00.000Z') });
    await app.ready();
    try {
      expect(await apiReport(app, password)).toEqual(report);
    } finally {
      await app.close();
    }

    // вход в API выше добавил сессию и запись истории — сравнение со снимком перед повтором
    const before = await tableCounts(target.db);
    await expect(transferSqliteToPg(dbFile, target)).rejects.toThrow('База не пустая');
    expect(await tableCounts(target.db)).toEqual(before);
  }, 180_000);
});

describe('--files: вложения из data/uploads в хранилище с теми же ключами', () => {
  it('файлы папки — под своими именами; подпапки не трогаются', async () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fc-uploads-'));
    fs.writeFileSync(path.join(dir, '11111111-1111-4111-8111-111111111111.png'), 'PNG');
    fs.writeFileSync(path.join(dir, '22222222-2222-4222-8222-222222222222.pdf'), 'PDF');
    fs.mkdirSync(path.join(dir, 'tmp'));
    const mem = memoryStore();
    expect(await copyUploads(dir, mem.store)).toEqual({ files: 2, bytes: 6 });
    expect([...mem.files.keys()].sort()).toEqual(['11111111-1111-4111-8111-111111111111.png', '22222222-2222-4222-8222-222222222222.pdf']);
    expect(mem.files.get('11111111-1111-4111-8111-111111111111.png')!.toString()).toBe('PNG');
  });
});
