import { loadConfig } from '../src/server/config';
import { openDatabase } from '../src/server/db/client';
import { migrateDatabase } from '../src/server/db/migrate';
import { seedCurrencies } from '../src/server/db/seed';

// Миграции Postgres на сборке Vercel (npm run vercel-build, план 2026-10-20-vercel-postgres, Р14): каждое окружение
// размечает свою базу из DATABASE_URL (Production — основная ветка Neon, Preview — ветка от интеграции) и обновляет
// справочник валют. Только Postgres: локальная база SQLite мигрирует сама при запуске (npm start).

if (!process.env.DATABASE_URL || !/^postgres(ql)?:\/\//.test(process.env.DATABASE_URL)) {
  console.error('Миграции: нужен DATABASE_URL вида postgres://… (Neon); локальная база SQLite мигрирует при запуске приложения');
  process.exit(1);
}
// для миграций нужна только база: секреты режима vercel (сессии, cron, Blob) здесь не проверяются
const config = loadConfig({ DATABASE_URL: process.env.DATABASE_URL, SESSION_SECRET: 'm'.repeat(32) });
const opened = await openDatabase(config.db);
try {
  await migrateDatabase(opened);
  await seedCurrencies(opened.db);
  console.log('Миграции Postgres применены');
} finally {
  await opened.close();
}
