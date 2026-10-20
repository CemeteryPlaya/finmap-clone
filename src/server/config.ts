import path from 'node:path';
import { z } from 'zod';

export type DeployMode = 'local' | 'cloudflare' | 'ngrok' | 'vps';

/**
 * Где лежат данные (Р1 плана 2026-10-20-vercel-postgres): DATABASE_URL postgres:// — Postgres (Neon), иначе файл SQLite
 * в DATA_DIR. pglite — Postgres в памяти процесса (тесты).
 */
export type DbConfig = { kind: 'sqlite'; path: string } | { kind: 'neon'; url: string } | { kind: 'pglite'; dataDir?: string };

export interface Config {
  appName: string;
  timezone: string;
  host: string;
  port: number;
  publicUrl: string;
  deployMode: DeployMode;
  cfTunnelToken: string | null;
  cloudflaredPath: string | null;
  ngrokAuthtoken: string | null;
  ngrokDomain: string | null;
  sessionSecret: string;
  allowedOrigins: string[];
  backupKeep: number;
  backupCopyDir: string | null;
  ratesSource: 'nbrk' | 'fixtures';
  dataDir: string;
  dbPath: string;
  db: DbConfig;
  uploadsDir: string;
  backupsDir: string;
  logsDir: string;
  binDir: string;
  lockPath: string;
}

const optional = z
  .string()
  .optional()
  .transform((v) => (v && v.trim() !== '' ? v.trim() : null));

const envSchema = z.object({
  APP_NAME: z.string().default('Учёт'),
  APP_TIMEZONE: z
    .string()
    .default('Asia/Almaty')
    .refine((v) => {
      try {
        new Intl.DateTimeFormat('en-CA', { timeZone: v });
        return true;
      } catch {
        return false;
      }
    }, 'неизвестный часовой пояс'),
  HOST: z.string().default('127.0.0.1'),
  PORT: z.coerce.number().int().min(0).max(65535).default(3000),
  PUBLIC_URL: optional,
  DEPLOY_MODE: z.enum(['local', 'cloudflare', 'ngrok', 'vps']).default('local'),
  CF_TUNNEL_TOKEN: optional,
  CLOUDFLARED_PATH: optional,
  NGROK_AUTHTOKEN: optional,
  NGROK_DOMAIN: optional,
  SESSION_SECRET: z.string({ message: 'SESSION_SECRET обязателен' }).min(32, 'SESSION_SECRET должен быть не короче 32 символов'),
  EXTRA_ORIGINS: z.string().default(''),
  BACKUP_KEEP: z.coerce.number().int().min(1).default(14),
  BACKUP_COPY_DIR: optional,
  DATABASE_URL: optional,
  RATES_SOURCE: z.enum(['nbrk', 'fixtures']).default('nbrk'),
  DATA_DIR: z.string().default('data'),
});

/** https-адрес с настоящим доменом: для него Caddy получает сертификат (§8.1, режим vps). */
function isPublicHttps(url: string | null): boolean {
  if (!url) return false;
  try {
    const u = new URL(url);
    return u.protocol === 'https:' && !['localhost', '127.0.0.1', '[::1]'].includes(u.hostname);
  } catch {
    return false;
  }
}

function toOrigin(url: string): string {
  return new URL(url).origin;
}

/**
 * Обрезает пробелы и считает пустое значение отсутствующим, чтобы срабатывали значения по умолчанию:
 * иначе HOST= превращается в '' (Fastify слушает все интерфейсы), а PORT= — в 0 (случайный порт).
 */
function normalizeEnv(env: Record<string, string | undefined>): Record<string, string | undefined> {
  const out: Record<string, string | undefined> = {};
  for (const key of Object.keys(envSchema.shape)) {
    const v = env[key]?.trim();
    out[key] = v === '' ? undefined : v;
  }
  return out;
}

export function loadConfig(env: Record<string, string | undefined> = process.env): Config {
  const parsed = envSchema.safeParse(normalizeEnv(env));
  if (!parsed.success) {
    const msg = parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ');
    throw new Error(`Ошибка конфигурации .env — ${msg}`);
  }
  const e = parsed.data;

  if (e.DEPLOY_MODE === 'cloudflare' && !e.CF_TUNNEL_TOKEN) {
    throw new Error('Ошибка конфигурации .env — CF_TUNNEL_TOKEN обязателен в режиме cloudflare');
  }
  if (e.DEPLOY_MODE === 'ngrok' && (!e.NGROK_AUTHTOKEN || !e.NGROK_DOMAIN)) {
    throw new Error('Ошибка конфигурации .env — NGROK_AUTHTOKEN и NGROK_DOMAIN обязательны в режиме ngrok');
  }

  if (e.DEPLOY_MODE === 'vps' && !isPublicHttps(e.PUBLIC_URL)) {
    throw new Error('Ошибка конфигурации .env — в режиме vps PUBLIC_URL обязателен: https://ваш-домен (например https://fin.example.kz)');
  }

  const publicUrl = (e.PUBLIC_URL ?? `http://localhost:${e.PORT}`).replace(/\/+$/, '');
  const origins = [
    toOrigin(publicUrl),
    `http://localhost:${e.PORT}`,
    `http://127.0.0.1:${e.PORT}`,
    ...e.EXTRA_ORIGINS.split(',').map((s) => s.trim()).filter(Boolean).map(toOrigin),
  ];
  const dataDir = path.resolve(e.DATA_DIR);

  return {
    appName: e.APP_NAME,
    timezone: e.APP_TIMEZONE,
    host: e.HOST,
    port: e.PORT,
    publicUrl,
    deployMode: e.DEPLOY_MODE,
    cfTunnelToken: e.CF_TUNNEL_TOKEN,
    cloudflaredPath: e.CLOUDFLARED_PATH,
    ngrokAuthtoken: e.NGROK_AUTHTOKEN,
    ngrokDomain: e.NGROK_DOMAIN,
    sessionSecret: e.SESSION_SECRET,
    allowedOrigins: [...new Set(origins)],
    backupKeep: e.BACKUP_KEEP,
    // Относительный путь — от папки проекта (рабочая папка npm start и задачи автозапуска).
    backupCopyDir: e.BACKUP_COPY_DIR ? path.resolve(e.BACKUP_COPY_DIR) : null,
    ratesSource: e.RATES_SOURCE,
    dataDir,
    dbPath: path.join(dataDir, 'app.db'),
    db: e.DATABASE_URL && /^postgres(ql)?:\/\//.test(e.DATABASE_URL) ? { kind: 'neon', url: e.DATABASE_URL } : { kind: 'sqlite', path: path.join(dataDir, 'app.db') },
    uploadsDir: path.join(dataDir, 'uploads'),
    backupsDir: path.join(dataDir, 'backups'),
    logsDir: path.join(dataDir, 'logs'),
    binDir: path.join(dataDir, 'bin'),
    lockPath: path.join(dataDir, 'app.lock'),
  };
}
