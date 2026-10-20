import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { openDatabase, type Db, type Sqlite } from '../../src/server/db/client';
import { migrateDatabase } from '../../src/server/db/migrate';
import { restoreKeys } from '../../src/server/db/raw';

/**
 * Диалект тестов (план 2026-10-20-vercel-postgres, Р16): TEST_DB=pg — Postgres в памяти (PGlite), иначе файл SQLite.
 * Проект vitest server-pg гоняет те же серверные тесты на Postgres.
 */
export const TEST_DIALECT: 'sqlite' | 'pg' = process.env.TEST_DB === 'pg' ? 'pg' : 'sqlite';
export const onPg = TEST_DIALECT === 'pg';

export interface TestDb {
  db: Db;
  /** Соединение better-sqlite3 — только у SQLite; тесты, которым оно нужно, на Postgres пропускаются. */
  sqlite: Sqlite | null;
  dir: string;
  /** Сырой SQL с параметрами «?» (как в SQLite) — строки результата; одинаков для обоих диалектов. */
  q<T = Record<string, any>>(text: string, ...params: unknown[]): Promise<T[]>;
  /** Несколько инструкций без параметров. */
  exec(text: string): Promise<void>;
  /** Сбой записи для тестов отката: триггер BEFORE event ON table бросает message (when — условие на SQL). */
  failOn(name: string, o: { table: string; event: 'INSERT' | 'UPDATE' | 'DELETE'; message: string; when?: string }): Promise<void>;
  dropFail(name: string, table: string): Promise<void>;
  cleanup(): Promise<void>;
}

/** Подзапрос: значения `expr` строк `from` по возрастанию id через запятую (group_concat / string_agg). */
export function listSql(expr: string, from: string): string {
  return onPg ? `(SELECT string_agg(${expr}, ',' ORDER BY id) FROM ${from})` : `(SELECT group_concat(v) FROM (SELECT ${expr} AS v FROM ${from} ORDER BY id))`;
}

/** «?» → $1, $2… вне строковых литералов. */
export function pgPlaceholders(text: string): string {
  let n = 0;
  let out = '';
  let quote = false;
  for (const ch of text) {
    if (ch === "'") quote = !quote;
    out += ch === '?' && !quote ? `$${++n}` : ch;
  }
  return out;
}

/** Снимок мигрированной базы Postgres — один на процесс vitest: базы тестов поднимаются из него (0,3 с вместо 2,7 с). */
let snapshot: Promise<Blob> | null = null;
/** Снимок размеченной базы PGlite — один на процесс (база в тестах поднимается из него). */
export async function pgSnapshot(): Promise<Blob> {
  snapshot ??= (async () => {
    const o = await openDatabase({ kind: 'pglite' });
    await migrateDatabase(o);
    const client = (o.db as unknown as { $client: { dumpDataDir(c: 'none'): Promise<Blob> } }).$client;
    const blob = await client.dumpDataDir('none');
    await o.close();
    return blob;
  })();
  return snapshot;
}

export async function createTestDb(): Promise<TestDb> {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fc-test-'));
  const removeDir = () => fs.rmSync(dir, { recursive: true, force: true });
  if (!onPg) {
    const o = await openDatabase({ kind: 'sqlite', path: path.join(dir, 'app.db') });
    await migrateDatabase(o);
    const sqlite = o.sqlite!;
    return {
      db: o.db,
      sqlite,
      dir,
      async q<T>(text: string, ...params: unknown[]) {
        const stmt = sqlite.prepare(text);
        if (stmt.reader) return stmt.all(...params) as T[];
        stmt.run(...params);
        return [];
      },
      async exec(text) {
        sqlite.exec(text);
      },
      async failOn(name, o) {
        sqlite.exec(`CREATE TRIGGER ${name} BEFORE ${o.event} ON ${o.table} ${o.when ? `WHEN ${o.when}` : ''} BEGIN SELECT RAISE(ABORT, '${o.message}'); END`);
      },
      async dropFail(name) {
        sqlite.exec(`DROP TRIGGER ${name}`);
      },
      async cleanup() {
        sqlite.close();
        removeDir();
      },
    };
  }
  const o = await openDatabase({ kind: 'pglite', snapshot: await pgSnapshot() });
  let closed = false;
  const client = (o.db as unknown as { $client: { query<T>(t: string, p?: unknown[]): Promise<{ rows: T[] }>; exec(t: string): Promise<unknown> } }).$client;
  return {
    db: o.db,
    sqlite: null,
    dir,
    async q<T>(text: string, ...params: unknown[]) {
      return restoreKeys(text, (await client.query<T>(pgPlaceholders(text), params)).rows);
    },
    async exec(text) {
      await client.exec(text);
    },
    async failOn(name, o) {
      await client.exec(
        `CREATE FUNCTION ${name}_fn() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF ${o.when ?? 'true'} THEN RAISE EXCEPTION '${o.message}'; END IF; RETURN NEW; END $$;
         CREATE TRIGGER ${name} BEFORE ${o.event} ON ${o.table} FOR EACH ROW EXECUTE FUNCTION ${name}_fn();`,
      );
    },
    async dropFail(name, table) {
      await client.exec(`DROP TRIGGER ${name} ON ${table}; DROP FUNCTION ${name}_fn();`);
    },
    // afterEach закрывает базу прошлого теста ещё раз, если тест свою не создал: PGlite второго закрытия не прощает
    async cleanup() {
      if (closed) return;
      closed = true;
      await o.close();
      removeDir();
    },
  };
}
