import { afterEach, describe, expect, it } from 'vitest';
import { createTestDb, type TestDb } from '../helpers/test-db';
import { ulower } from '../../src/server/db/client';
import { appliedMigrationsCount, codeMigrationsCount } from '../../src/server/db/migrate';
import { seedCurrencies } from '../../src/server/db/seed';
import { currencies } from '../../src/server/db/schema';

let t: TestDb;
afterEach(() => t?.cleanup());

describe('db', () => {
  it('включает WAL и внешние ключи', async () => {
    t = await createTestDb();
    expect(t.sqlite!.pragma('journal_mode', { simple: true })).toBe('wal');
    expect(t.sqlite!.pragma('foreign_keys', { simple: true })).toBe(1);
  });

  it('применяет все миграции кода', async () => {
    t = await createTestDb();
    expect(codeMigrationsCount()).toBeGreaterThan(0);
    expect(appliedMigrationsCount(t.sqlite!)).toBe(codeMigrationsCount());
  });

  it('ulower приводит кириллицу к нижнему регистру и ё→е', async () => {
    expect(ulower('АРЕНДА Ёлки')).toBe('аренда елки');
    expect(ulower(null)).toBeNull();
    t = await createTestDb();
    const row = (await t.q("SELECT ulower('ЗАКУП Бара') AS v"))[0] as { v: string };
    expect(row.v).toBe('закуп бара');
  });

  it('seedCurrencies идемпотентен', async () => {
    t = await createTestDb();
    await seedCurrencies(t.db);
    await seedCurrencies(t.db);
    const rows = t.db.select().from(currencies).all();
    expect(rows.find((r) => r.code === 'KZT')?.minorUnits).toBe(2);
    expect(new Set(rows.map((r) => r.code)).size).toBe(rows.length);
  });
});
