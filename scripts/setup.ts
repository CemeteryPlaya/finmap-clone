import crypto from 'node:crypto';
import fs from 'node:fs';
import { loadConfig } from '../src/server/config';
import { openDb } from '../src/server/db/client';
import { runMigrations } from '../src/server/db/migrate';
import { seedCurrencies } from '../src/server/db/seed';
import { AppError } from '../src/server/errors';
import { createAuditService } from '../src/server/modules/audit/service';
import { createUsersService } from '../src/server/modules/users/service';
import { ensureCloudflared, type Pins } from './lib/cloudflared';
import { parseEnv, updateEnvText } from './lib/env-file';
import { createPrompt } from './lib/prompt';

const prompt = createPrompt();
const envText = fs.existsSync('.env') ? fs.readFileSync('.env', 'utf8') : fs.readFileSync('.env.example', 'utf8');
const current = parseEnv(envText);
const updates: Record<string, string> = {};

if (!current.get('SESSION_SECRET')) updates.SESSION_SECRET = crypto.randomBytes(48).toString('base64url');

console.log('Режимы: local — только этот компьютер; cloudflare — свой домен через Cloudflare Tunnel;');
console.log('        ngrok — статический домен ngrok; vps — сервер с Caddy.');
let mode = '';
while (!['local', 'cloudflare', 'ngrok', 'vps'].includes(mode)) {
  mode = await prompt.ask('Режим развёртывания', current.get('DEPLOY_MODE') || 'local');
}
updates.DEPLOY_MODE = mode;

if (mode === 'cloudflare') {
  const host = await prompt.ask('Адрес сайта (например fin.example.kz)', current.get('PUBLIC_URL')?.replace(/^https:\/\//, ''));
  updates.PUBLIC_URL = `https://${host.replace(/^https?:\/\//, '').replace(/\/+$/, '')}`;
  updates.CF_TUNNEL_TOKEN = (await prompt.askSecret('Токен туннеля Cloudflare (Zero Trust → Tunnels)')) || current.get('CF_TUNNEL_TOKEN') || '';
} else if (mode === 'ngrok') {
  updates.NGROK_AUTHTOKEN = (await prompt.askSecret('NGROK_AUTHTOKEN')) || current.get('NGROK_AUTHTOKEN') || '';
  const domain = await prompt.ask('Статический домен ngrok (xxx.ngrok-free.app)', current.get('NGROK_DOMAIN'));
  updates.NGROK_DOMAIN = domain;
  updates.PUBLIC_URL = `https://${domain}`;
} else if (mode === 'vps') {
  const host = await prompt.ask('Домен сайта (например fin.example.kz)', current.get('PUBLIC_URL')?.replace(/^https:\/\//, ''));
  updates.PUBLIC_URL = `https://${host.replace(/^https?:\/\//, '').replace(/\/+$/, '')}`;
} else {
  updates.PUBLIC_URL = '';
}

fs.writeFileSync('.env', updateEnvText(envText, updates));
process.loadEnvFile('.env');
const config = loadConfig();
fs.mkdirSync(config.dataDir, { recursive: true });

if (mode === 'cloudflare') {
  const pins = JSON.parse(fs.readFileSync('scripts/cloudflared-pins.json', 'utf8')) as Pins;
  const p = await ensureCloudflared({ binDir: config.binDir, pins, customPath: config.cloudflaredPath });
  console.log(`cloudflared готов: ${p}`);
}

const { sqlite, db } = openDb(config.dbPath);
runMigrations(db);
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
