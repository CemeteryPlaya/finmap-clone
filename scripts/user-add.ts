import fs from 'node:fs';
import { loadConfig } from '../src/server/config';
import { openDb } from '../src/server/db/client';
import { migrateWithBackup } from '../src/server/db/migrate';
import { AppError } from '../src/server/errors';
import { createAuditService } from '../src/server/modules/audit/service';
import { createBackupService } from '../src/server/modules/backup/service';
import { createUsersService } from '../src/server/modules/users/service';
import { createPrompt } from './lib/prompt';

if (fs.existsSync('.env')) process.loadEnvFile('.env');
const config = loadConfig();
fs.mkdirSync(config.dataDir, { recursive: true });
const dbExisted = fs.existsSync(config.dbPath);
const { sqlite, db } = openDb(config.dbPath);
fs.mkdirSync(config.backupsDir, { recursive: true });
migrateWithBackup({
  db,
  sqlite,
  dbExisted,
  backup: createBackupService({ sqlite, config, log: (m, e) => (e ? console.error(m, e) : console.log(m)) }),
});
const users = createUsersService(db, createAuditService(db));
const prompt = createPrompt();

try {
  const login = await prompt.ask('Логин');
  const name = await prompt.ask('Имя', login);
  const password = await prompt.askSecret('Пароль (не короче 10 символов)');
  const again = await prompt.askSecret('Повторите пароль');
  if (password !== again) throw new Error('Пароли не совпадают');
  const u = await users.create({ login, name, password }, null);
  console.log(`Пользователь «${u.login}» создан.`);
} catch (e) {
  if (e instanceof AppError && e.fields) console.error(Object.values(e.fields).join('\n'));
  else console.error((e as Error).message);
  process.exitCode = 1;
} finally {
  prompt.close();
  sqlite.close();
}
