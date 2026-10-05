import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { loadConfig } from '../src/server/config';
import { openDb } from '../src/server/db/client';
import { runMigrations } from '../src/server/db/migrate';
import { startServer } from '../src/server/main';
import { createAuditService } from '../src/server/modules/audit/service';
import { createUsersService } from '../src/server/modules/users/service';

const E2E_PORT = Number(process.env.E2E_PORT ?? 41731);
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fc-e2e-'));
const config = loadConfig({
  SESSION_SECRET: 'e'.repeat(40),
  DATA_DIR: dataDir,
  PORT: String(E2E_PORT),
  RATES_SOURCE: 'fixtures',
});
fs.mkdirSync(config.dataDir, { recursive: true });
{
  const { sqlite, db } = openDb(config.dbPath);
  runMigrations(db);
  await createUsersService(db, createAuditService(db)).create({ login: 'admin', name: 'Админ', password: 'e2e-password-1' }, null);
  sqlite.close();
}
await startServer(config, { logger: false });
console.log('E2E server ready');
