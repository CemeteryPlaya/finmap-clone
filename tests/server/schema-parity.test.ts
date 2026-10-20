import { getTableConfig as pgConfig } from 'drizzle-orm/pg-core';
import { getTableConfig as sqliteConfig } from 'drizzle-orm/sqlite-core';
import { describe, expect, it } from 'vitest';
import { pgTables, sqliteTables } from '../../src/server/db/schema';

/**
 * Паритет схем (план 2026-10-20-vercel-postgres, Р4): схема Postgres строится из схемы SQLite, тест держит правило —
 * те же таблицы, колонки, ключи, индексы и внешние ключи, а типы — по Р5.
 */
const action = (a: string | undefined) => (a === undefined || a === 'no action' ? 'no action' : a);

describe('паритет схем SQLite и Postgres', () => {
  const names = Object.keys(sqliteTables);

  it('те же таблицы под теми же именами', () => {
    expect(Object.keys(pgTables)).toEqual(names);
    for (const k of names) expect(pgConfig(pgTables[k as keyof typeof pgTables]).name).toBe(sqliteConfig(sqliteTables[k as keyof typeof sqliteTables]).name);
  });

  it.each(names)('%s: колонки, индексы, ключи', (k) => {
    const s = sqliteConfig(sqliteTables[k as keyof typeof sqliteTables]);
    const p = pgConfig(pgTables[k as keyof typeof pgTables]);
    const typeOf = (columnType: string) => (columnType === 'SQLiteBoolean' ? 'boolean' : columnType === 'SQLiteInteger' ? 'bigint' : 'text');
    expect(p.columns.map((c) => [c.name, c.getSQLType(), c.notNull, c.hasDefault, c.primary])).toEqual(
      // целый первичный ключ без автоинкремента в SQLite — псевдоним rowid («есть умолчание»); в Postgres умолчания нет:
      // это ключ-ссылка (audit_undo, stock_doc_postings), его всегда передают явно
      s.columns.map((c) => [
        c.name,
        typeOf(c.columnType),
        c.notNull,
        c.primary && c.columnType === 'SQLiteInteger' ? (c as unknown as { config?: { autoIncrement?: boolean } }).config?.autoIncrement === true : c.hasDefault,
        c.primary,
      ]),
    );
    const idx = (xs: { config: { name: string; unique: boolean; columns: unknown[] } }[]) =>
      xs.map((i) => [i.config.name, i.config.unique, i.config.columns.map((c) => (c as { name: string }).name)]);
    expect(idx(p.indexes as never)).toEqual(idx(s.indexes as never));
    expect(p.primaryKeys.map((x) => x.columns.map((c) => c.name))).toEqual(s.primaryKeys.map((x) => x.columns.map((c) => c.name)));
    const fks = (xs: { getName(): string; onDelete?: string; reference(): { columns: { name: string }[]; foreignColumns: { name: string; table: unknown }[] } }[], tableName: (t: unknown) => string) =>
      xs.map((f) => {
        const r = f.reference();
        return [f.getName(), r.columns.map((c) => c.name), tableName(r.foreignColumns[0]!.table), r.foreignColumns.map((c) => c.name), action(f.onDelete)];
      });
    expect(fks(p.foreignKeys as never, (t) => pgConfig(t as never).name)).toEqual(fks(s.foreignKeys as never, (t) => sqliteConfig(t as never).name));
  });

  it('суммы и id — bigint, флаги — boolean (Р5)', () => {
    const op = pgConfig(pgTables.operations);
    expect(op.columns.find((c) => c.name === 'amount')!.getSQLType()).toBe('bigint');
    expect(op.columns.find((c) => c.name === 'id')!.getSQLType()).toBe('bigint');
    expect(pgConfig(pgTables.stockItems).columns.find((c) => c.name === 'is_combo')!.getSQLType()).toBe('boolean');
  });
});
