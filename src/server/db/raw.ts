import type { SQL } from 'drizzle-orm';
import type { Executor } from './client';
import { driverOf, inLine } from './tx';

/**
 * Сырые запросы — только через эти помощники (план 2026-10-20-vercel-postgres, Р9): они одинаковы для всех драйверов,
 * а различия диалектов (форма результата) живут здесь, а не в модулях.
 */
export async function rows<T = Record<string, unknown>>(ex: Executor, q: SQL): Promise<T[]> {
  if (driverOf(ex) === 'sqlite') return (await inLine(ex, (db) => db.all(q))) as T[];
  const result = (await (ex as unknown as PgExecutor).execute(q)) as { rows: Record<string, unknown>[] };
  return restoreCase(ex, q, result.rows) as T[];
}

export async function one<T = Record<string, unknown>>(ex: Executor, q: SQL): Promise<T | undefined> {
  return (await rows<T>(ex, q))[0];
}

export async function exec(ex: Executor, q: SQL): Promise<void> {
  if (driverOf(ex) === 'sqlite') await inLine(ex, (db) => db.run(q));
  else await (ex as unknown as PgExecutor).execute(q);
}

/** Замена синхронного get у построителя Drizzle: первая строка результата или undefined. */
export async function first<T>(q: PromiseLike<T[]>): Promise<T | undefined> {
  return (await q)[0];
}

interface PgExecutor {
  execute(q: SQL): Promise<unknown>;
  dialect: { sqlToQuery(q: SQL): { sql: string } };
}

/**
 * Postgres приводит псевдонимы без кавычек к нижнему регистру (AS paidAt → paidat); сами запросы от этого не ломаются —
 * ссылки на псевдоним сводятся так же. Ключи строк возвращаются к написанию из запроса: по всем словам вида camelCase в его
 * тексте (псевдоним может быть и без AS; столбцы базы — snake_case, их это не задевает).
 */
function restoreCase(ex: Executor, q: SQL, list: Record<string, unknown>[]): Record<string, unknown>[] {
  return restoreKeys((ex as unknown as PgExecutor).dialect.sqlToQuery(q).sql, list);
}

/** Ключи строк Postgres — в написании из текста запроса (см. restoreCase); нужен и тестам с сырым SQL. */
export function restoreKeys<T>(text: string, list: T[]): T[] {
  const names = new Map<string, string>();
  for (const [name] of text.matchAll(/\b[a-z][a-z0-9_]*[A-Z][A-Za-z0-9_]*\b/g)) names.set(name.toLowerCase(), name);
  if (names.size === 0) return list;
  return list.map((r) => {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(r as Record<string, unknown>)) out[names.get(k) ?? k] = v;
    return out as T;
  });
}
