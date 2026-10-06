import crypto from 'node:crypto';
import fs from 'node:fs';
import { loadConfig } from '../src/server/config';
import { openDb } from '../src/server/db/client';
import { migrateWithBackup } from '../src/server/db/migrate';
import { seedCurrencies } from '../src/server/db/seed';
import { AppError } from '../src/server/errors';
import { createAuditService } from '../src/server/modules/audit/service';
import { createBackupService } from '../src/server/modules/backup/service';
import { createUsersService } from '../src/server/modules/users/service';
import { checkCloudflaredPath, ensureCloudflared, type Pins } from './lib/cloudflared';
import { ENV_TEMPLATE, normalizeHost, parseEnv, updateEnvText, writeEnvFileSecure } from './lib/env-file';
import { createPrompt } from './lib/prompt';

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
fs.mkdirSync(config.dataDir, { recursive: true });

if (mode === 'cloudflare') {
  try {
    const pins = JSON.parse(fs.readFileSync('scripts/cloudflared-pins.json', 'utf8')) as Pins;
    const p = await ensureCloudflared({ binDir: config.binDir, pins, customPath: config.cloudflaredPath });
    console.log(`cloudflared готов: ${p}`);
  } catch (e) {
    console.log((e as Error).message);
    for (;;) {
      const custom = (await prompt.ask('Путь к cloudflared (CLOUDFLARED_PATH), Enter — пропустить')).trim();
      if (!custom) {
        console.log('cloudflared не настроен: укажите CLOUDFLARED_PATH в настройках и повторите npm run setup до запуска.');
        break;
      }
      const checked = checkCloudflaredPath(custom);
      if (checked.ok) {
        writeEnvFileSecure(ENV_FILE, updateEnvText(fs.readFileSync(ENV_FILE, 'utf8'), { CLOUDFLARED_PATH: checked.path }));
        console.log(`CLOUDFLARED_PATH сохранён: ${checked.path}`);
        break;
      }
      console.log(checked.message);
    }
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
seedCurrencies(db);
const users = createUsersService(db, createAuditService(db));
if (users.count() === 0) {
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
