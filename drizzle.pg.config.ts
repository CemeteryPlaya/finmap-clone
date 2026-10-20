import { defineConfig } from 'drizzle-kit';

/** Миграции Postgres (Vercel, Neon) — из схемы, построенной по схеме SQLite (план 2026-10-20-vercel-postgres, Р3). */
export default defineConfig({
  dialect: 'postgresql',
  schema: './src/server/db/schema-pg.ts',
  out: './src/server/db/migrations-pg',
});
