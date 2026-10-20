import { type SQL, sql } from 'drizzle-orm';
import { currentDialect } from './schema';

/**
 * Выражения, которые у SQLite и Postgres пишутся по-разному (план 2026-10-20-vercel-postgres, Р8): ветки по диалекту
 * живут здесь, а не в модулях.
 */

/** Значения столбца группы одной строкой через запятую: GROUP_CONCAT в SQLite, string_agg в Postgres. */
export function groupConcat(column: SQL): SQL {
  return currentDialect() === 'pg' ? sql`string_agg(CAST(${column} AS text), ',')` : sql`GROUP_CONCAT(${column})`;
}
