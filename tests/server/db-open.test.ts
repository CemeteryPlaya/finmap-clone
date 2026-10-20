import { count, sql } from 'drizzle-orm';
import { afterEach, describe, expect, it } from 'vitest';
import { openDatabase, type OpenedDatabase } from '../../src/server/db/client';
import { migrateDatabase } from '../../src/server/db/migrate';
import { rows } from '../../src/server/db/raw';
import { withTx } from '../../src/server/db/tx';
import { loadConfig } from '../../src/server/config';

let opened: OpenedDatabase | null = null;
afterEach(async () => {
  await opened?.close();
  opened = null;
});

describe('конфиг базы (Р1)', () => {
  it('DATABASE_URL postgres:// — Neon, иначе файл SQLite', () => {
    const base = { SESSION_SECRET: 's'.repeat(40), DATA_DIR: '/tmp/fc' };
    expect(loadConfig({ ...base, DATABASE_URL: 'postgres://u:p@host/db' }).db).toEqual({ kind: 'neon', url: 'postgres://u:p@host/db' });
    expect(loadConfig({ ...base, DATABASE_URL: 'postgresql://u:p@host/db' }).db.kind).toBe('neon');
    expect(loadConfig(base).db).toEqual({ kind: 'sqlite', path: loadConfig(base).dbPath });
  });
});

describe('Postgres в памяти (PGlite)', () => {
  it('открывается, миграции применены, суммы bigint — number, внешние ключи действуют', async () => {
    opened = await openDatabase({ kind: 'pglite' });
    await migrateDatabase(opened);
    const { db } = opened;
    expect(opened.dialect).toBe('pg');
    const [r] = await rows<{ s: number; n: number }>(db, sql`SELECT SUM(x) AS s, COUNT(*) AS n FROM (VALUES (30000000000::bigint), (1::bigint)) v(x)`);
    expect(r).toEqual({ s: 30000000001, n: 2 });
    await expect(rows(db, sql`INSERT INTO accounts (company_id, name, currency, starting_balance, opened_at, order_index, created_at) VALUES (999, 'x', 'KZT', 0, '2026-01-01', 0, 'x')`)).rejects.toThrow();
    const { currencies } = await import('../../src/server/db/schema');
    expect((await db.select({ n: count() }).from(currencies))[0]!.n).toBe(0);
  });

  it('ulower: регистр и «ё» без учёта (поиск журнала и названия проектов)', async () => {
    opened = await openDatabase({ kind: 'pglite' });
    await migrateDatabase(opened);
    const [r] = await rows<{ v: string }>(opened.db, sql`SELECT ulower('ЁЛКА Әлем ABC') AS v`);
    expect(r!.v).toBe('елка әлем abc');
  });

  it('запрос через db внутри транзакции идёт в неё (иначе ждал бы её конца)', async () => {
    opened = await openDatabase({ kind: 'pglite' });
    await migrateDatabase(opened);
    const { db } = opened;
    const n = await withTx(db, async () => {
      await rows(db, sql`INSERT INTO currencies (code, name, symbol, minor_units) VALUES ('KZT', 'Т', 'Т', 2)`);
      return (await rows<{ n: number }>(db, sql`SELECT COUNT(*) AS n FROM currencies`))[0]!.n;
    });
    expect(n).toBe(1);
  });
});
