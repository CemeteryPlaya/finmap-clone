import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { buildApp } from '../src/server/app';
import { loadConfig } from '../src/server/config';
import { openDatabase, openDb } from '../src/server/db/client';
import { migrateDatabase, runMigrations } from '../src/server/db/migrate';
import { seedCurrencies } from '../src/server/db/seed';
import { startServer } from '../src/server/main';
import { createAuditService } from '../src/server/modules/audit/service';
import { createUsersService } from '../src/server/modules/users/service';
import { startSenetDemo } from '../scripts/lib/senet-demo';

const E2E_PORT = Number(process.env.E2E_PORT ?? 41731);
// поддельный Senet (план 2026-11-02-senet-autopost, задача 16): смены за последние сутки
const senet = await startSenetDemo();
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fc-e2e-'));
const config = loadConfig({
  SESSION_SECRET: 'e'.repeat(40),
  DATA_DIR: dataDir,
  PORT: String(E2E_PORT),
  RATES_SOURCE: 'fixtures',
  SENET_API_BASE: senet.base,
  SECRET_KEY: Buffer.alloc(32, 7).toString('base64'),
});
fs.mkdirSync(config.dataDir, { recursive: true });

if (process.env.E2E_DB === 'pg') {
  // Postgres в памяти (PGlite) — тот же код приложения, что на Vercel с Neon (план 2026-10-20-vercel-postgres, задача 12)
  for (const d of [config.uploadsDir, config.backupsDir, config.logsDir]) fs.mkdirSync(d, { recursive: true });
  const opened = await openDatabase({ kind: 'pglite' });
  await migrateDatabase(opened);
  await seedCurrencies(opened.db);
  await createUsersService(opened.db, createAuditService(opened.db)).create({ login: 'admin', name: 'Админ', password: 'e2e-password-1' }, null);
  const app = await buildApp({ config, db: opened.db, sqlite: null, logger: false });
  await app.listen({ host: config.host, port: config.port });
} else {
  const { sqlite, db } = openDb(config.dbPath);
  runMigrations(db);
  await createUsersService(db, createAuditService(db)).create({ login: 'admin', name: 'Админ', password: 'e2e-password-1' }, null);
  sqlite.close();
  await startServer(config, { logger: false });
}
console.log('E2E server ready');
