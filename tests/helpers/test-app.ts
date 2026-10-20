import type { SQL } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../../src/server/app';
import { loadConfig, type Config } from '../../src/server/config';
import type { Db, Sqlite } from '../../src/server/db/client';
import { rows } from '../../src/server/db/raw';
import { createAuditService } from '../../src/server/modules/audit/service';
import { createUsersService, type AuthUser } from '../../src/server/modules/users/service';
import { createTestDb, type TestDb } from './test-db';

export const ORIGIN_HEADERS = { origin: 'http://localhost:3000', 'x-requested-with': 'fetch' } as const;

export function testConfig(dir: string, overrides: Record<string, string> = {}): Config {
  return loadConfig({ SESSION_SECRET: 's'.repeat(40), DATA_DIR: dir, RATES_SOURCE: 'fixtures', ...overrides });
}

export interface TestApp {
  app: FastifyInstance;
  db: Db;
  /** Соединение better-sqlite3 — только у SQLite (TEST_DB=pg — null). */
  sqlite: Sqlite | null;
  config: Config;
  dir: string;
  /** Сырой запрос к БД теста (одинаков для всех диалектов). */
  sql<T = Record<string, unknown>>(q: SQL): Promise<T[]>;
  /** Сырой SQL с параметрами «?» — одинаков для обоих диалектов. */
  q<T = Record<string, any>>(text: string, ...params: unknown[]): Promise<T[]>;
  exec(text: string): Promise<void>;
  failOn: TestDb['failOn'];
  dropFail: TestDb['dropFail'];
  cleanup(): Promise<void>;
}

// extraRoutes регистрирует тестовые маршруты до ready(): после ready() добавлять маршруты нельзя.
export async function createTestApp(
  overrides: Record<string, string> = {},
  extraRoutes?: (app: FastifyInstance) => void,
  now?: () => Date,
): Promise<TestApp> {
  const t = await createTestDb();
  const config = testConfig(t.dir, overrides);
  const app = await buildApp({ config, db: t.db, sqlite: t.sqlite, logger: false, extraRoutes, now });
  await app.ready();
  return {
    app,
    db: t.db,
    sqlite: t.sqlite,
    config,
    dir: t.dir,
    sql: (q) => rows(t.db, q),
    q: (text, ...params) => t.q(text, ...params),
    exec: (text) => t.exec(text),
    failOn: (name, o) => t.failOn(name, o),
    dropFail: (name, table) => t.dropFail(name, table),
    async cleanup() {
      await app.close();
      await t.cleanup();
    },
  };
}

export async function seedUser(t: TestApp, login = 'admin', password = 'correct-horse-1'): Promise<AuthUser> {
  return createUsersService(t.db, createAuditService(t.db)).create({ login, name: 'Тест', password }, null);
}

export async function loginAs(t: TestApp, login = 'admin', password = 'correct-horse-1'): Promise<string> {
  const res = await t.app.inject({
    method: 'POST',
    url: '/api/v1/auth/login',
    headers: ORIGIN_HEADERS,
    payload: { login, password },
  });
  if (res.statusCode !== 200) throw new Error(`login failed: ${res.statusCode} ${res.body}`);
  const cookie = res.cookies.find((c) => c.name === 'sid');
  if (!cookie) throw new Error('no sid cookie');
  return `sid=${cookie.value}`;
}
