import { defineConfig } from 'vitest/config';

/**
 * Проекты (план 2026-10-20-vercel-postgres, Р16): unit — клиент и общий код; server-sqlite и server-pg — те же серверные
 * тесты на файле SQLite и на Postgres (PGlite). На Postgres не идут тесты самого SQLite: миграции SQLite, бэкап копией
 * файла и восстановление, запуск процесса с блокировкой, проверка выгрузки по файлу базы (import:check).
 */
/** Только Postgres: перенос SQLite → Postgres готовит SQLite-сторону в отдельном процессе. */
const PG_ONLY = ['tests/server/sqlite-to-pg.test.ts', 'tests/server/neon-pool.test.ts'];

const SQLITE_ONLY = [
  'tests/server/schema-0*.test.ts',
  'tests/server/db.test.ts',
  'tests/server/migrate.test.ts',
  'tests/server/backup.test.ts',
  'tests/server/restore.test.ts',
  'tests/server/main*.test.ts',
  'tests/server/import-check.test.ts',
  'tests/server/schema-bind.test.ts',
];

const common = { environment: 'node' as const, pool: 'forks' as const, testTimeout: 15000 };

export default defineConfig({
  test: {
    projects: [
      { test: { ...common, name: 'unit', include: ['tests/client/**/*.test.ts', 'tests/shared/**/*.test.ts'] } },
      { test: { ...common, name: 'server-sqlite', include: ['tests/server/**/*.test.ts'], exclude: PG_ONLY, env: { TEST_DB: 'sqlite' } } },
      // PGlite поднимается в каждом процессе из снимка (WASM): при полной загрузке ядер первый тест файла ждёт секунды
      {
        test: { ...common, name: 'server-pg', include: ['tests/server/**/*.test.ts'], exclude: SQLITE_ONLY, env: { TEST_DB: 'pg' }, testTimeout: 60000, hookTimeout: 60000 },
      },
    ],
  },
});
