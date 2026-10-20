import { spawnSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { loadConfig } from '../src/server/config';
import { ensureDataDir } from '../src/server/data-dir';
import { openDb } from '../src/server/db/client';
import { migrateWithBackup } from '../src/server/db/migrate';
import { seedCurrencies } from '../src/server/db/seed';
import { AppError } from '../src/server/errors';
import { createAuditService } from '../src/server/modules/audit/service';
import { createBackupService } from '../src/server/modules/backup/service';
import { createUsersService } from '../src/server/modules/users/service';
import { appRunning, appRunningMessage } from './lib/app-running';
import { checkCloudflaredPath, ensureCloudflared, type Pins } from './lib/cloudflared';
import { ENV_TEMPLATE, normalizeHost, parseEnv, updateEnvText, writeEnvFileSecure } from './lib/env-file';
import { createPrompt } from './lib/prompt';
import { icaclsRestrictArgs, projectOutsideProfile } from './lib/windows-acl';
import { windowsUserId } from './lib/windows-task';

const prompt = createPrompt();
const ENV_FILE = '.env';
const TEMPLATE_FILE = '.env.example';
const envText = fs.existsSync(ENV_FILE)
  ? fs.readFileSync(ENV_FILE, 'utf8')
  : fs.existsSync(TEMPLATE_FILE)
    ? fs.readFileSync(TEMPLATE_FILE, 'utf8')
    : ENV_TEMPLATE;
const current = parseEnv(envText);
const updates: Record<string, string> = {};

if (!current.get('SESSION_SECRET')) updates.SESSION_SECRET = crypto.randomBytes(48).toString('base64url');

async function askHost(question: string, def?: string): Promise<string> {
  for (;;) {
    const host = normalizeHost(await prompt.ask(question, def));
    if (host) return host;
    console.log('Адрес не может быть пустым.');
  }
}

async function askToken(question: string, existing?: string): Promise<string> {
  for (;;) {
    const token = (await prompt.askSecret(question)).trim() || existing || '';
    if (token) return token;
    console.log('Значение не может быть пустым.');
  }
}

console.log('Режимы: local — только этот компьютер; cloudflare — свой домен через Cloudflare Tunnel;');
console.log('        ngrok — статический домен ngrok; vps — сервер с Caddy.');
let mode = '';
while (!['local', 'cloudflare', 'ngrok', 'vps'].includes(mode)) {
  mode = await prompt.ask('Режим развёртывания', current.get('DEPLOY_MODE') || 'local');
}
updates.DEPLOY_MODE = mode;

if (mode === 'cloudflare') {
  const host = await askHost('Адрес сайта (например fin.example.kz)', normalizeHost(current.get('PUBLIC_URL') ?? '') || undefined);
  updates.PUBLIC_URL = `https://${host}`;
  updates.CF_TUNNEL_TOKEN = await askToken('Токен туннеля Cloudflare (Zero Trust → Tunnels)', current.get('CF_TUNNEL_TOKEN'));
} else if (mode === 'ngrok') {
  updates.NGROK_AUTHTOKEN = await askToken('NGROK_AUTHTOKEN', current.get('NGROK_AUTHTOKEN'));
  const domain = await askHost('Статический домен ngrok (xxx.ngrok-free.app)', current.get('NGROK_DOMAIN') || undefined);
  updates.NGROK_DOMAIN = domain;
  updates.PUBLIC_URL = `https://${domain}`;
} else if (mode === 'vps') {
  const host = await askHost('Домен сайта (например fin.example.kz)', normalizeHost(current.get('PUBLIC_URL') ?? '') || undefined);
  updates.PUBLIC_URL = `https://${host}`;
} else {
  updates.PUBLIC_URL = '';
}

writeEnvFileSecure(ENV_FILE, updateEnvText(envText, updates));
process.loadEnvFile(ENV_FILE);
const config = loadConfig();
ensureDataDir(config.dataDir);

// Windows: папка проекта может наследовать «Пользователи: чтение» и «Прошедшие проверку: изменение»
// (например, если она прямо на C:\). Закрываем data\ и файл настроек (секреты, токены). Вызывается после
// каждой записи файла настроек: запись через временный файл возвращает унаследованные права.
function applySettingsAcl(): void {
  if (process.platform !== 'win32') return;
  const user = windowsUserId(process.env, os.userInfo().username);
  for (const [target, kind] of [
    [config.dataDir, 'dir'],
    [path.resolve(ENV_FILE), 'file'],
  ] as const) {
    const r = spawnSync('icacls', icaclsRestrictArgs(target, user, kind), { stdio: 'ignore' });
    if (r.status !== 0) {
      console.warn(`Внимание: не удалось закрыть ${target} от других пользователей Windows (icacls, код ${r.status ?? '—'}).`);
    }
  }
}

if (process.platform === 'win32' && projectOutsideProfile(process.cwd(), os.homedir())) {
  console.warn(
    `Внимание: папка проекта находится вне профиля пользователя (${path.resolve(process.cwd())}). ` +
      'Другие пользователи Windows могут изменить программу и через неё прочитать данные. ' +
      'Перенесите проект в %USERPROFILE%\\Учёт (README, «Установка на ПК клуба»).',
  );
}

// Приложение работает: базу и cloudflared не трогаем. Настройки уже сохранены — закрываем их и выходим.
const running = await appRunning(config);
if (running) {
  applySettingsAcl();
  prompt.close();
  console.error(appRunningMessage(running, config.port));
  process.exit(1);
}

if (mode === 'cloudflare') {
  await setupCloudflared();
}
applySettingsAcl();

async function setupCloudflared(): Promise<void> {
  const tryEnsure = async (customPath: string | null): Promise<boolean> => {
    try {
      const pins = JSON.parse(fs.readFileSync('scripts/cloudflared-pins.json', 'utf8')) as Pins;
      const p = await ensureCloudflared({ binDir: config.binDir, pins, customPath });
      console.log(`cloudflared готов: ${p}`);
      return true;
    } catch (e) {
      console.log((e as Error).message);
      return false;
    }
  };
  if (await tryEnsure(config.cloudflaredPath ?? null)) return;
  const hadCustom = Boolean(config.cloudflaredPath);
  const hint = hadCustom
    ? 'Путь к cloudflared (CLOUDFLARED_PATH), Enter — убрать свой путь и скачать закреплённую версию'
    : 'Путь к cloudflared (CLOUDFLARED_PATH), Enter — пропустить';
  for (;;) {
    const custom = (await prompt.ask(hint)).trim();
    if (!custom) {
      if (hadCustom) {
        writeEnvFileSecure(ENV_FILE, updateEnvText(fs.readFileSync(ENV_FILE, 'utf8'), { CLOUDFLARED_PATH: '' }));
        console.log('CLOUDFLARED_PATH убран из настроек.');
        if (await tryEnsure(null)) return;
      }
      console.log('cloudflared не настроен: укажите CLOUDFLARED_PATH в настройках и повторите npm run setup до запуска.');
      return;
    }
    const checked = checkCloudflaredPath(custom);
    if (checked.ok) {
      writeEnvFileSecure(ENV_FILE, updateEnvText(fs.readFileSync(ENV_FILE, 'utf8'), { CLOUDFLARED_PATH: checked.path }));
      console.log(`CLOUDFLARED_PATH сохранён: ${checked.path}`);
      return;
    }
    console.log(checked.message);
  }
}

const dbExisted = fs.existsSync(config.dbPath);
const { sqlite, db } = openDb(config.dbPath);
fs.mkdirSync(config.backupsDir, { recursive: true });
migrateWithBackup({
  db,
  sqlite,
  dbExisted,
  backup: createBackupService({ sqlite, config, log: (m, e) => (e ? console.error(m, e) : console.log(m)) }),
});
await seedCurrencies(db);
const users = createUsersService(db, createAuditService(db));
if ((await users.count()) === 0) {
  console.log('Создаём первого пользователя.');
  for (;;) {
    try {
      const login = await prompt.ask('Логин');
      const name = await prompt.ask('Имя', login);
      const password = await prompt.askSecret('Пароль (не короче 10 символов)');
      if (password !== (await prompt.askSecret('Повторите пароль'))) {
        console.log('Пароли не совпадают.');
        continue;
      }
      await users.create({ login, name, password }, null);
      break;
    } catch (e) {
      console.log(e instanceof AppError && e.fields ? Object.values(e.fields).join('\n') : (e as Error).message);
    }
  }
}
sqlite.close();
prompt.close();
console.log('\nГотово. Запуск: npm start');
console.log(`Адрес: ${config.publicUrl}`);
if (mode === 'vps') {
  console.log('Дальше на сервере: npm run service:install — подготовит Caddyfile и systemd-юнит и подскажет команды (README, раздел «vps — свой сервер с Caddy»).');
}
