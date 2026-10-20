import { AsyncLocalStorage } from 'node:async_hooks';
import type { Db, Executor, Sqlite } from './client';

/**
 * Асинхронные транзакции поверх одного соединения better-sqlite3 (план 2026-10-20-vercel-postgres, фаза В-1).
 *
 * Drizzle с better-sqlite3 не принимает async-колбэк транзакции, а соединение одно: пока транзакция ждёт await, любой
 * другой запрос процесса выполнился бы внутри неё. Поэтому у каждой базы — очередь: транзакция целиком и каждый
 * запрос вне транзакции — отдельные задания, по одному за раз. Сервисы получают «окружающую» базу (ambient): внутри
 * withTx её запросы идут прямо в текущую транзакцию (контекст — AsyncLocalStorage), снаружи — встают в очередь.
 * Вложенный withTx — точка сохранения.
 */
export type TxBehavior = 'deferred' | 'immediate';

const RAW = Symbol('raw-db');
const scope = new AsyncLocalStorage<{ db: Db; depth: number }>();
const queues = new WeakMap<Db, Promise<unknown>>();

/** Настоящая база за окружающей (или сама база, если её не оборачивали). */
function rawOf(ex: Executor): Db {
  return ((ex as unknown as Record<symbol, Db | undefined>)[RAW] ?? ex) as Db;
}

/** Задание в очередь базы; результат — результат задания. */
function enqueue<T>(db: Db, job: () => Promise<T>): Promise<T> {
  const run = (queues.get(db) ?? Promise.resolve()).then(job);
  queues.set(
    db,
    run.catch(() => undefined),
  );
  return run;
}

const inTx = (db: Db) => scope.getStore()?.db === db;

/** Защита низкоуровневых записей, которые имеют смысл только частью чужой транзакции (импорт). */
export function assertInTx(ex: Executor, what: string): void {
  if (!inTx(rawOf(ex))) throw new Error(`${what}: только внутри транзакции`);
}

/** Дождаться своей очереди перед синхронным вызовом драйвера (сырые запросы raw.ts). Внутри транзакции — сразу. */
export function inLine<T>(ex: Executor, call: (db: Executor) => T): Promise<Awaited<T>> {
  const db = rawOf(ex);
  if (inTx(db)) return Promise.resolve(call(db)) as Promise<Awaited<T>>;
  return enqueue(db, () => Promise.resolve(call(db))) as Promise<Awaited<T>>;
}

/** Построитель Drizzle и всё, что из него получается: выполнение (then) — через очередь базы, если не в транзакции. */
function gated<T extends object>(obj: T, db: Db): T {
  return new Proxy(obj, {
    get(target, prop) {
      const v = Reflect.get(target, prop, target) as unknown;
      if (typeof v !== 'function') return v;
      if (prop === 'then') {
        const then = v as (res?: (x: unknown) => unknown, rej?: (e: unknown) => unknown) => unknown;
        return (res?: (x: unknown) => unknown, rej?: (e: unknown) => unknown) => {
          if (inTx(db)) return then.call(target, res, rej);
          return enqueue(db, () => new Promise((ok, fail) => void then.call(target, ok, fail))).then(res, rej);
        };
      }
      return (...args: unknown[]) => {
        const r = (v as (...a: unknown[]) => unknown).apply(target, args);
        return r !== null && typeof r === 'object' ? gated(r, db) : r;
      };
    },
  });
}

/** Окружающая база: то, что получают сервисы (openDb). */
export function ambient(db: Db): Db {
  return new Proxy(db, {
    get(target, prop) {
      if (prop === RAW) return target;
      const v = Reflect.get(target, prop, target) as unknown;
      if (typeof v !== 'function') return v;
      return (...args: unknown[]) => {
        const r = (v as (...a: unknown[]) => unknown).apply(target, args);
        return r !== null && typeof r === 'object' && !inTx(target) ? gated(r, target) : r;
      };
    },
  });
}

export async function withTx<T>(ex: Executor, fn: (tx: Executor) => Promise<T>, opts: { behavior?: TxBehavior } = {}): Promise<T> {
  const db = rawOf(ex);
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
  return enqueue(db, async () => {
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
}
