import { getTableColumns, type Column } from 'drizzle-orm';
import { bigint, boolean, foreignKey, index, pgTable, primaryKey, text, uniqueIndex, type PgColumnBuilderBase, type PgTable } from 'drizzle-orm/pg-core';
import { getTableConfig, type SQLiteTable } from 'drizzle-orm/sqlite-core';

/**
 * Таблицы Postgres из схемы SQLite (план 2026-10-20-vercel-postgres, Р3–Р5): одна схема — источник истины, вторая
 * строится по ней, поэтому разойтись они не могут. Правила (Р5): целое — bigint (mode: number), целое-флаг — boolean,
 * текст — text (с тем же enum), автоинкрементный ключ — identity «by default» (явные id при переносе разрешены).
 * Имена таблиц, колонок, индексов и внешних ключей — те же.
 */
export function toPgTables<T extends Record<string, SQLiteTable>>(tables: T): { [K in keyof T]: PgTable } {
  const byName = new Map<string, PgTable>();
  const out = {} as { [K in keyof T]: PgTable };
  /** Колонка PG по таблице SQLite и колонке SQLite; таблица уже построена (внешние ключи читаются лениво). */
  const pgColumn = (table: SQLiteTable, column: Column): Column => {
    const pg = byName.get(getTableConfig(table).name);
    if (!pg) throw new Error(`pg-schema: таблица ${getTableConfig(table).name} не построена`);
    const hit = Object.values(getTableColumns(pg)).find((c) => c.name === column.name);
    if (!hit) throw new Error(`pg-schema: нет колонки ${column.name}`);
    return hit;
  };

  for (const [key, table] of Object.entries(tables) as [keyof T, SQLiteTable][]) {
    const cfg = getTableConfig(table);
    const columns: Record<string, PgColumnBuilderBase> = {};
    for (const [jsKey, col] of Object.entries(getTableColumns(table))) {
      const c = col as Column & { columnType: string; autoIncrement?: boolean; config?: { autoIncrement?: boolean } };
      let b: PgColumnBuilderBase;
      switch (c.columnType) {
        case 'SQLiteBoolean':
          b = boolean(c.name);
          break;
        case 'SQLiteInteger':
          b = c.primary && c.config?.autoIncrement ? bigint(c.name, { mode: 'number' }).generatedByDefaultAsIdentity() : bigint(c.name, { mode: 'number' });
          break;
        case 'SQLiteText':
          b = c.enumValues?.length ? text(c.name, { enum: c.enumValues as [string, ...string[]] }) : text(c.name);
          break;
        default:
          throw new Error(`pg-schema: тип ${c.columnType} (${cfg.name}.${c.name}) не поддержан`);
      }
      const builder = b as PgColumnBuilderBase & { notNull(): typeof b; primaryKey(): typeof b; default(v: unknown): typeof b };
      let x = builder as typeof builder;
      if (c.primary) x = x.primaryKey() as typeof builder;
      else if (c.notNull) x = x.notNull() as typeof builder;
      if (c.hasDefault && c.default !== undefined) x = x.default(c.default) as typeof builder;
      columns[jsKey] = x;
    }
    const pg = pgTable(cfg.name, columns, (t) => {
      const col = (sqliteColumn: Column) => (t as Record<string, Column>)[Object.entries(getTableColumns(table)).find(([, c]) => c === sqliteColumn)![0]]!;
      return [
        ...cfg.indexes.map((i) => {
          const cols = i.config.columns.map((c) => col(c as Column)) as [Column, ...Column[]];
          return (i.config.unique ? uniqueIndex(i.config.name) : index(i.config.name)).on(...(cols as never as [never, ...never[]]));
        }),
        ...cfg.primaryKeys.map((p) => primaryKey({ name: p.getName(), columns: p.columns.map((c) => col(c)) as never })),
        ...cfg.foreignKeys.map((fk) => {
          const ref = fk.reference();
          const built = foreignKey({
            name: fk.getName(),
            columns: ref.columns.map((c) => col(c)) as never,
            foreignColumns: ref.foreignColumns.map((c) => pgColumn(ref.foreignTable, c)) as never,
          });
          if (fk.onDelete) built.onDelete(fk.onDelete);
          if (fk.onUpdate) built.onUpdate(fk.onUpdate);
          return built;
        }),
      ];
    });
    byName.set(cfg.name, pg);
    out[key] = pg;
  }
  return out;
}
