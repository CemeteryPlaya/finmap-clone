import fs from 'node:fs';
import { loadConfig } from '../src/server/config';
import { openDb } from '../src/server/db/client';
import { migrateWithBackup } from '../src/server/db/migrate';
import { AppError } from '../src/server/errors';
import { createAuditService } from '../src/server/modules/audit/service';
import { createBackupService } from '../src/server/modules/backup/service';
import { createUsersService } from '../src/server/modules/users/service';
import { createPrompt } from './lib/prompt';

// Сброс пароля из консоли, когда войти в интерфейс некому: npm run user:passwd [-- <логин>]
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
  const login = process.argv[2] ?? (await prompt.ask('Логин'));
  const password = await prompt.askSecret('Новый пароль (не короче 10 символов)');
  const again = await prompt.askSecret('Повторите пароль');
  if (password !== again) throw new Error('Пароли не совпадают');
  const u = await users.setPasswordByLogin(login, password);
  console.log(`Пароль пользователя «${u.login}» изменён, все его сеансы завершены.`);
  if (u.disabledAt) console.log("Внимание: пользователь отключён и войти не сможет — включите его в «Настройки → Пользователи».");
} catch (e) {
  if (e instanceof AppError && e.fields) console.error(Object.values(e.fields).join('\n'));
  else console.error((e as Error).message);
  process.exitCode = 1;
} finally {
  prompt.close();
  sqlite.close();
}
