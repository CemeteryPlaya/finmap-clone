import { AsyncLocalStorage } from 'node:async_hooks';
import type { Db, Executor, Sqlite } from './client';

/**
 * Асинхронная транзакция поверх better-sqlite3 — переходный приём фазы В-1 (план 2026-10-20-vercel-postgres): Drizzle
 * с better-sqlite3 не принимает async-колбэк. Одно соединение, поэтому транзакции одной БД выстраиваются в очередь,
 * а вложенный вызов внутри транзакции становится точкой сохранения. Задача 8 заменяет это на `db.transaction` libsql.
 */
export type TxBehavior = 'deferred' | 'immediate';

const scope = new AsyncLocalStorage<{ db: Db; depth: number }>();
const queues = new WeakMap<Db, Promise<unknown>>();

function root(ex: Executor): Db {
  return ex as Db;
}

export async function withTx<T>(ex: Executor, fn: (tx: Executor) => Promise<T>, opts: { behavior?: TxBehavior } = {}): Promise<T> {
  const db = root(ex);
  const sqlite = (db as Db & { $client: Sqlite }).$client;
  const current = scope.getStore();
  if (current && current.db === db) {
    const name = `sp_${current.depth + 1}`;
    sqlite.exec(`SAVEPOINT ${name}`);
    try {
      const result = await scope.run({ db, depth: current.depth + 1 }, () => fn(db));
      sqlite.exec(`RELEASE ${name}`);
      return result;
    } catch (e) {
      sqlite.exec(`ROLLBACK TO ${name}`);
      sqlite.exec(`RELEASE ${name}`);
      throw e;
    }
  }

  const prev = queues.get(db) ?? Promise.resolve();
  const run = prev.then(async () => {
    sqlite.exec(opts.behavior === 'immediate' ? 'BEGIN IMMEDIATE' : 'BEGIN');
    try {
      const result = await scope.run({ db, depth: 0 }, () => fn(db));
      sqlite.exec('COMMIT');
      return result;
    } catch (e) {
      if (sqlite.inTransaction) sqlite.exec('ROLLBACK');
      throw e;
    }
  });
  queues.set(
    db,
    run.catch(() => undefined),
  );
  return run;
}
