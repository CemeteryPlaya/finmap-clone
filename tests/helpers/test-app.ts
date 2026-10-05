import type { FastifyInstance } from 'fastify';
import { buildApp } from '../../src/server/app';
import { loadConfig, type Config } from '../../src/server/config';
import type { Db, Sqlite } from '../../src/server/db/client';
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
