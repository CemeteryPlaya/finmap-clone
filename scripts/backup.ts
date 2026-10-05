import fs from 'node:fs';
import { loadConfig } from '../src/server/config';
import { openDb } from '../src/server/db/client';
import { createBackupService } from '../src/server/modules/backup/service';

if (fs.existsSync('.env')) process.loadEnvFile('.env');
const config = loadConfig();
if (!fs.existsSync(config.dbPath)) {
  console.error(`База не найдена: ${config.dbPath}`);
  process.exit(1);
}
const { sqlite } = openDb(config.dbPath);
try {
  const file = createBackupService({ sqlite, config, log: (m) => console.log(m) }).create('manual');
  console.log(`Готово: ${file}`);
} finally {
  sqlite.close();
}
