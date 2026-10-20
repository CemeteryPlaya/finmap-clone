import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Сторож перехода на асинхронный доступ к БД (план 2026-10-20-vercel-postgres, Р9): в серверном коде нет синхронных
 * вызовов Drizzle (`.all()`, `.get()`, `.run()`), сырого better-sqlite3 (`sqlite.`) и синхронных транзакций.
 * PENDING — файлы, которые ещё не переведены (после фазы В-1 — пусто).
 */
const ROOT = path.resolve(__dirname, '../../src/server');

/**
 * Остаются навсегда: механизм транзакций и сырых запросов, а также то, что существует только у SQLite — соединение,
 * миграции, бэкап копией файла и быстрая запись импорта подготовленными выражениями (у Postgres свои реализации).
 */
const ALLOWED = new Set(['db/tx.ts', 'db/raw.ts', 'db/client.ts', 'db/migrate.ts', 'modules/backup/restore.ts', 'modules/backup/service.ts', 'modules/operations/writer.ts']);

const PENDING = new Set<string>([]);

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
