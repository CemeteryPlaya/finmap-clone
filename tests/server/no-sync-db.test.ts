import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Сторож перехода на асинхронный доступ к БД (план 2026-10-20-vercel-postgres, Р9): в серверном коде нет синхронных
 * вызовов Drizzle (`.all()`, `.get()`, `.run()`), сырого better-sqlite3 (`sqlite.`) и синхронных транзакций.
 * PENDING — файлы, которые ещё не переведены; список сокращается задачами 2–8 и в задаче 8 становится пустым.
 */
const ROOT = path.resolve(__dirname, '../../src/server');

/** Остаются навсегда: здесь живёт сам механизм транзакций. */
const ALLOWED = new Set(['db/tx.ts', 'db/raw.ts']);

const PENDING = new Set([
  'db/client.ts',
  'db/migrate.ts',
  'db/seed.ts',
  'modules/accounts/service.ts',
  'modules/audit/mutate.ts',
  'modules/audit/service.ts',
  'modules/auth/sessions.ts',
  'modules/backup/restore.ts',
  'modules/backup/service.ts',
  'modules/balances/service.ts',
  'modules/categories/service.ts',
  'modules/companies/guard.ts',
  'modules/companies/service.ts',
  'modules/counterparties/service.ts',
  'modules/imports/commit.ts',
  'modules/imports/history.ts',
  'modules/imports/match.ts',
  'modules/imports/preview.ts',
  'modules/imports/undo.ts',
  'modules/operations/service.ts',
  'modules/operations/writer.ts',
  'modules/projects/service.ts',
  'modules/rates/routes.ts',
  'modules/rates/service.ts',
  'modules/references/service.ts',
  'modules/stock/analytics.ts',
  'modules/stock/balance.ts',
  'modules/stock/catalog.ts',
  'modules/stock/count.ts',
  'modules/stock/docs.ts',
  'modules/stock/events.ts',
  'modules/stock/import-template.ts',
  'modules/stock/import.ts',
  'modules/stock/payments.ts',
  'modules/stock/postings.ts',
  'modules/stock/recalc.ts',
  'modules/stock/warehouses.ts',
  'modules/tags/service.ts',
  'modules/users/service.ts',
]);

const SYNC_DB = /(?<!job)\.(all|get|run)\(\)|\b(db|tx|ex)\.(all|get|run)\b|\bsqlite\.|\.transaction\(/;

function walk(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(dir, e.name);
    return e.isDirectory() ? walk(p) : p.endsWith('.ts') ? [p] : [];
  });
}

describe('синхронный доступ к БД', () => {
  const files = walk(ROOT).map((f) => path.relative(ROOT, f).replaceAll('\\', '/'));
  const offenders = files.filter((f) => SYNC_DB.test(fs.readFileSync(path.join(ROOT, f), 'utf8')));

  it('нет в переведённых файлах', () => {
    expect(offenders.filter((f) => !PENDING.has(f) && !ALLOWED.has(f))).toEqual([]);
  });

  it('список ожидающих не содержит уже переведённых файлов', () => {
    expect([...PENDING].filter((f) => !offenders.includes(f))).toEqual([]);
  });
});
