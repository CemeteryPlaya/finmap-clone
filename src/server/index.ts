import fs from 'node:fs';
import { loadConfig } from './config';
import { LockHeldError } from './lock';
import { EXIT_LOCK_HELD, startServer } from './main';

if (fs.existsSync('.env')) process.loadEnvFile('.env');

try {
  const s = await startServer(loadConfig());
  s.app.log.info(`Сервер запущен: ${s.url}`);
} catch (e) {
  if (e instanceof LockHeldError) {
    console.error(e.message);
    process.exit(EXIT_LOCK_HELD);
  }
  console.error(e);
  process.exit(1);
}
