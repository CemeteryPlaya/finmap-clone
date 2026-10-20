import { afterEach, describe, expect, it } from 'vitest';
import { createTestDb } from '../helpers/test-db';
import { ulower } from '../../src/server/db/client';
import { appliedMigrationsCount, codeMigrationsCount } from '../../src/server/db/migrate';
import { seedCurrencies } from '../../src/server/db/seed';
import { currencies } from '../../src/server/db/schema';

let t: ReturnType<typeof createTestDb>;
afterEach(() => t?.cleanup());

describe('db', () => {
  it('включает WAL и внешние ключи', () => {
    t = createTestDb();
    expect(t.sqlite.pragma('journal_mode', { simple: true })).toBe('wal');
    expect(t.sqlite.pragma('foreign_keys', { simple: true })).toBe(1);
  });

  it('применяет все миграции кода', () => {
    t = createTestDb();
    expect(codeMigrationsCount()).toBeGreaterThan(0);
    expect(appliedMigrationsCount(t.sqlite)).toBe(codeMigrationsCount());
  });

  it('ulower приводит кириллицу к нижнему регистру и ё→е', () => {
    expect(ulower('АРЕНДА Ёлки')).toBe('аренда елки');
    expect(ulower(null)).toBeNull();
    t = createTestDb();
    const row = t.sqlite.prepare("SELECT ulower('ЗАКУП Бара') AS v").get() as { v: string };
    expect(row.v).toBe('закуп бара');
  });

  it('seedCurrencies идемпотентен', async () => {
    t = createTestDb();
    await seedCurrencies(t.db);
    await seedCurrencies(t.db);
    const rows = t.db.select().from(currencies).all();
    expect(rows.find((r) => r.code === 'KZT')?.minorUnits).toBe(2);
    expect(new Set(rows.map((r) => r.code)).size).toBe(rows.length);
  });
});
