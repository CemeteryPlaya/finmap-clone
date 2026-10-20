import type { SQL } from 'drizzle-orm';
import type { Executor } from './client';
import { inLine } from './tx';

/**
 * Сырые запросы — только через эти помощники (план 2026-10-20-vercel-postgres, Р9): они одинаковы для всех драйверов,
 * а различия диалектов (форма результата) живут здесь, а не в модулях.
 */
export async function rows<T = Record<string, unknown>>(ex: Executor, q: SQL): Promise<T[]> {
  return (await inLine(ex, (db) => db.all(q))) as T[];
}

export async function one<T = Record<string, unknown>>(ex: Executor, q: SQL): Promise<T | undefined> {
  return (await rows<T>(ex, q))[0];
}

export async function exec(ex: Executor, q: SQL): Promise<void> {
  await inLine(ex, (db) => db.run(q));
}

/** Замена синхронного get у построителя Drizzle: первая строка результата или undefined. */
export async function first<T>(q: PromiseLike<T[]>): Promise<T | undefined> {
  return (await q)[0];
}
