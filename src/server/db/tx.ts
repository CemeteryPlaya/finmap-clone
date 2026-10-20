import { AsyncLocalStorage } from 'node:async_hooks';
import { sql } from 'drizzle-orm';
import type { Db, Executor, Sqlite } from './client';

/**
 * Асинхронные транзакции и «окружающая» база (план 2026-10-20-vercel-postgres, фазы В-1 и В-2).
 *
 * Сервисы получают окружающую базу (ambient): внутри withTx её запросы идут прямо в текущую транзакцию (контекст —
 * AsyncLocalStorage), снаружи — в базу. Вложенный withTx — точка сохранения. По драйверам:
 * - sqlite (better-sqlite3: одно соединение, Drizzle не принимает async-колбэк транзакции) — у базы очередь: транзакция
 *   целиком и каждый запрос вне транзакции — отдельные задания, по одному за раз; иначе, пока транзакция ждёт await,
 *   чужой запрос выполнился бы внутри неё;
 * - pglite (одно соединение) — очередь держит сам PGlite, транзакции — Drizzle;
 * - pool (Neon) — транзакции Drizzle; первая инструкция каждой — pg_advisory_xact_lock (Р7): пишущие транзакции идут по
 *   одной, как в SQLite, и инварианты склада, остатков и отмены не перепроверяются под READ COMMITTED.
 */
export type TxBehavior = 'deferred' | 'immediate';
export type DriverKind = 'sqlite' | 'pglite' | 'pool';

/** Ключ глобальной блокировки писателей Postgres (Р7). */
export const WRITER_LOCK = 7001;

const RAW = Symbol('raw-db');
interface Scope {
  db: Db;
  tx: Executor;
  depth: number;
}
const scope = new AsyncLocalStorage<Scope>();
const queues = new WeakMap<Db, Promise<unknown>>();
const drivers = new WeakMap<object, DriverKind>();
/** Транзакция Postgres → её база (транзакцию могут передать дальше, в том числе внешнюю — из вложенной). */
const owners = new WeakMap<object, Db>();

/** Настоящая база за окружающей базой или транзакцией. */
function rawOf(ex: Executor): Db {
  return ((ex as unknown as Record<symbol, Db | undefined>)[RAW] ?? owners.get(ex as object) ?? ex) as Db;
}

/** Драйвер базы (или её транзакции): по нему raw.ts выбирает форму запроса. */
export function driverOf(ex: Executor): DriverKind {
  return drivers.get(rawOf(ex)) ?? 'sqlite';
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

/**
 * Вызов драйвера в свою очередь: внутри транзакции — сразу с ней; у SQLite вне транзакции — заданием очереди
 * (синхронный вызов не должен попасть в чужую открытую транзакцию); у Postgres — сразу с базой.
 */
export function inLine<T>(ex: Executor, call: (db: Executor) => T): Promise<Awaited<T>> {
  const db = rawOf(ex);
  if (inTx(db)) return Promise.resolve(call(scope.getStore()!.tx)) as Promise<Awaited<T>>;
  if (drivers.get(db) !== 'sqlite') return Promise.resolve(call(db)) as Promise<Awaited<T>>;
  return enqueue(db, () => Promise.resolve(call(db))) as Promise<Awaited<T>>;
}

/** Построитель Drizzle (SQLite) и всё, что из него получается: выполнение (then) — через очередь базы, если не в транзакции. */
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

/** Окружающая база: то, что получают сервисы (openDb, openDatabase). */
export function ambient(db: Db, kind: DriverKind = 'sqlite'): Db {
  drivers.set(db, kind);
  return new Proxy(db, {
    get(target, prop) {
      if (prop === RAW) return target;
      const store = scope.getStore();
      const cur = (store?.db === target ? store.tx : target) as object;
      const v = Reflect.get(cur, prop, cur) as unknown;
      if (typeof v !== 'function') return v;
      return (...args: unknown[]) => {
        const r = (v as (...a: unknown[]) => unknown).apply(cur, args);
        return kind === 'sqlite' && r !== null && typeof r === 'object' && !inTx(target) ? gated(r, target) : r;
      };
    },
  });
}

type PgTxHost = { transaction<R>(fn: (tx: Executor) => Promise<R>): Promise<R>; execute(q: unknown): Promise<unknown> };

export async function withTx<T>(ex: Executor, fn: (tx: Executor) => Promise<T>, opts: { behavior?: TxBehavior } = {}): Promise<T> {
  const db = rawOf(ex);
  const kind = drivers.get(db) ?? 'sqlite';
  const current = scope.getStore();
  const nested = current !== undefined && current.db === db;

  if (kind !== 'sqlite') {
    const host = (nested ? current.tx : db) as unknown as PgTxHost;
    return host.transaction(async (tx) => {
      owners.set(tx as object, db);
      if (!nested && kind === 'pool') await (tx as unknown as PgTxHost).execute(sql`SELECT pg_advisory_xact_lock(${WRITER_LOCK})`);
      return scope.run({ db, tx, depth: nested ? current.depth + 1 : 0 }, () => fn(tx));
    });
  }

  const sqlite = (db as Db & { $client: Sqlite }).$client;
  if (nested) {
    const name = `sp_${current.depth + 1}`;
    sqlite.exec(`SAVEPOINT ${name}`);
    try {
      const result = await scope.run({ db, tx: db, depth: current.depth + 1 }, () => fn(db));
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
      const result = await scope.run({ db, tx: db, depth: 0 }, () => fn(db));
      sqlite.exec('COMMIT');
      return result;
    } catch (e) {
      if (sqlite.inTransaction) sqlite.exec('ROLLBACK');
      throw e;
    }
  });
}
