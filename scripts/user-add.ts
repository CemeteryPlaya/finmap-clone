import fs from 'node:fs';
import { loadConfig } from '../src/server/config';
import { AppError } from '../src/server/errors';
import { createAuditService } from '../src/server/modules/audit/service';
import { createUsersService } from '../src/server/modules/users/service';
import { createPrompt } from './lib/prompt';
import { openScriptDb } from './lib/script-db';

if (fs.existsSync('.env')) process.loadEnvFile('.env');
const config = loadConfig();
// SQLite в DATA_DIR или Postgres из DATABASE_URL (Neon на Vercel: DATABASE_URL=… npm run …)
const { db, close } = await openScriptDb(config);
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
  await close();
}
