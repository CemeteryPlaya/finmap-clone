import type { FastifyInstance } from 'fastify';
import { buildApp } from '../../src/server/app';
import { loadConfig, type Config } from '../../src/server/config';
import type { Db, Sqlite } from '../../src/server/db/client';
import { createAuditService } from '../../src/server/modules/audit/service';
import { createUsersService, type AuthUser } from '../../src/server/modules/users/service';
import { createTestDb } from './test-db';

export const ORIGIN_HEADERS = { origin: 'http://localhost:3000', 'x-requested-with': 'fetch' } as const;

export function testConfig(dir: string, overrides: Record<string, string> = {}): Config {
  return loadConfig({ SESSION_SECRET: 's'.repeat(40), DATA_DIR: dir, RATES_SOURCE: 'fixtures', ...overrides });
}

export interface TestApp {
  app: FastifyInstance;
  db: Db;
  sqlite: Sqlite;
  config: Config;
  dir: string;
  cleanup(): Promise<void>;
}

// extraRoutes регистрирует тестовые маршруты до ready(): после ready() добавлять маршруты нельзя.
export async function createTestApp(
  overrides: Record<string, string> = {},
  extraRoutes?: (app: FastifyInstance) => void,
): Promise<TestApp> {
  const t = createTestDb();
  const config = testConfig(t.dir, overrides);
  const app = await buildApp({ config, db: t.db, sqlite: t.sqlite, logger: false, extraRoutes });
  await app.ready();
  return {
    app,
    db: t.db,
    sqlite: t.sqlite,
    config,
    dir: t.dir,
    async cleanup() {
      await app.close();
      t.cleanup();
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
