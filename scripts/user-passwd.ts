import fs from 'node:fs';
import { loadConfig } from '../src/server/config';
import { AppError } from '../src/server/errors';
import { createAuditService } from '../src/server/modules/audit/service';
import { createUsersService } from '../src/server/modules/users/service';
import { createPrompt } from './lib/prompt';
import { openScriptDb } from './lib/script-db';

// Сброс пароля из консоли, когда войти в интерфейс некому: npm run user:passwd [-- <логин>]
if (fs.existsSync('.env')) process.loadEnvFile('.env');
const config = loadConfig();
// SQLite в DATA_DIR или Postgres из DATABASE_URL (Neon на Vercel: DATABASE_URL=… npm run …)
const { db, close } = await openScriptDb(config);
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
  await close();
}
