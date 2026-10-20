import { describe, expect, it } from 'vitest';
import os from 'node:os';
import path from 'node:path';
import { loadConfig } from '../../src/server/config';

const base = { SESSION_SECRET: 'x'.repeat(32) };

describe('loadConfig', () => {
  it('APP_TIMEZONE: неизвестный пояс — ошибка, известные принимаются', () => {
    expect(() => loadConfig({ ...base, APP_TIMEZONE: 'Mars/Olympus' })).toThrow(/APP_TIMEZONE/);
    expect(loadConfig({ ...base, APP_TIMEZONE: 'Asia/Almaty' }).timezone).toBe('Asia/Almaty');
    expect(loadConfig({ ...base, APP_TIMEZONE: 'UTC' }).timezone).toBe('UTC');
  });

  it('ошибка APP_TIMEZONE — без двойного префикса', () => {
    let message = '';
    try {
      loadConfig({ ...base, APP_TIMEZONE: 'Mars/Olympus' });
    } catch (e) {
      message = (e as Error).message;
    }
    expect(message).toContain('APP_TIMEZONE: неизвестный часовой пояс');
    expect(message).not.toContain('APP_TIMEZONE: APP_TIMEZONE');
  });

  it('применяет значения по умолчанию', () => {
    const c = loadConfig(base);
    expect(c.appName).toBe('Учёт');
    expect(c.timezone).toBe('Asia/Almaty');
    expect(c.host).toBe('127.0.0.1');
    expect(c.port).toBe(3000);
    expect(c.publicUrl).toBe('http://localhost:3000');
    expect(c.deployMode).toBe('local');
    expect(c.backupKeep).toBe(14);
    expect(c.backupCopyDir).toBeNull();
    expect(c.dbPath).toBe(path.resolve('data', 'app.db'));
    expect(c.lockPath).toBe(path.resolve('data', 'app.lock'));
  });

  it('пустые значения (HOST=, PORT= и т. п.) дают значения по умолчанию, а не все интерфейсы и случайный порт', () => {
    const c = loadConfig({
      ...base,
      HOST: '',
      PORT: '',
      BACKUP_KEEP: '',
      APP_NAME: '',
      APP_TIMEZONE: '  ',
      DEPLOY_MODE: '',
      RATES_SOURCE: '',
      DATA_DIR: ' ',
      EXTRA_ORIGINS: '',
    });
    expect(c.host).toBe('127.0.0.1');
    expect(c.port).toBe(3000);
    expect(c.backupKeep).toBe(14);
    expect(c.appName).toBe('Учёт');
    expect(c.timezone).toBe('Asia/Almaty');
    expect(c.deployMode).toBe('local');
    expect(c.ratesSource).toBe('nbrk');
    expect(c.dbPath).toBe(path.resolve('data', 'app.db'));
  });

  it('обрезает пробелы вокруг значений; явный PORT=0 допустим', () => {
    const c = loadConfig({ ...base, HOST: ' 0.0.0.0 ', PORT: ' 0 ', APP_NAME: ' Клуб ' });
    expect(c.host).toBe('0.0.0.0');
    expect(c.port).toBe(0);
    expect(c.appName).toBe('Клуб');
  });

  it('собирает список разрешённых origin без дублей и хвостовых слэшей', () => {
    const c = loadConfig({
      ...base,
      PORT: '3100',
      PUBLIC_URL: 'https://fin.example.kz/',
      EXTRA_ORIGINS: 'http://192.168.1.10:3100, http://localhost:3100',
    });
    expect(c.allowedOrigins).toEqual([
      'https://fin.example.kz',
      'http://localhost:3100',
      'http://127.0.0.1:3100',
      'http://192.168.1.10:3100',
    ]);
  });

  it('отклоняет короткий SESSION_SECRET', () => {
    expect(() => loadConfig({ SESSION_SECRET: 'short' })).toThrow(/SESSION_SECRET/);
  });

  it('требует токен в режиме cloudflare и домен в режиме ngrok', () => {
    expect(() => loadConfig({ ...base, DEPLOY_MODE: 'cloudflare' })).toThrow(/CF_TUNNEL_TOKEN/);
    expect(() => loadConfig({ ...base, DEPLOY_MODE: 'ngrok', NGROK_AUTHTOKEN: 't' })).toThrow(/NGROK_DOMAIN/);
  });

  it('режим vps требует PUBLIC_URL с https и настоящим доменом', () => {
    expect(() => loadConfig({ ...base, DEPLOY_MODE: 'vps' })).toThrow(/vps PUBLIC_URL обязателен/);
    expect(() => loadConfig({ ...base, DEPLOY_MODE: 'vps', PUBLIC_URL: 'http://fin.example.kz' })).toThrow(/https/);
    expect(() => loadConfig({ ...base, DEPLOY_MODE: 'vps', PUBLIC_URL: 'https://localhost' })).toThrow(/vps/);
    expect(() => loadConfig({ ...base, DEPLOY_MODE: 'vps', PUBLIC_URL: 'не адрес' })).toThrow(/vps/);
    const c = loadConfig({ ...base, DEPLOY_MODE: 'vps', PUBLIC_URL: 'https://fin.example.kz/' });
    expect(c.deployMode).toBe('vps');
    expect(c.publicUrl).toBe('https://fin.example.kz');
  });

  it('BACKUP_COPY_DIR: относительный путь — от папки проекта', () => {
    expect(loadConfig({ ...base, BACKUP_COPY_DIR: 'copies' }).backupCopyDir).toBe(path.resolve('copies'));
    expect(loadConfig({ ...base, BACKUP_COPY_DIR: '' }).backupCopyDir).toBeNull();
  });

  it('учитывает DATA_DIR для всех путей данных', () => {
    const c = loadConfig({ ...base, DATA_DIR: 'tmp/x' });
    expect(c.dbPath).toBe(path.resolve('tmp/x', 'app.db'));
    expect(c.uploadsDir).toBe(path.resolve('tmp/x', 'uploads'));
    expect(c.backupsDir).toBe(path.resolve('tmp/x', 'backups'));
    expect(c.binDir).toBe(path.resolve('tmp/x', 'bin'));
  });
});

describe('режим vercel (план 2026-10-20-vercel-postgres, задача 13)', () => {
  const vercel = {
    ...base,
    DEPLOY_MODE: 'vercel',
    DATABASE_URL: 'postgres://user:pass@ep-x.eu-central-1.aws.neon.tech/neondb',
    CRON_SECRET: 'c'.repeat(16),
    BLOB_READ_WRITE_TOKEN: 'vercel_blob_rw_x',
  };

  it('без DATABASE_URL, CRON_SECRET или BLOB_READ_WRITE_TOKEN — понятная ошибка', () => {
    expect(() => loadConfig({ ...vercel, DATABASE_URL: undefined })).toThrow('На Vercel нужен Postgres: DATABASE_URL');
    expect(() => loadConfig({ ...vercel, CRON_SECRET: undefined })).toThrow(/CRON_SECRET/);
    expect(() => loadConfig({ ...vercel, CRON_SECRET: 'short' })).toThrow(/CRON_SECRET/);
    expect(() => loadConfig({ ...vercel, BLOB_READ_WRITE_TOKEN: undefined })).toThrow(/BLOB_READ_WRITE_TOKEN/);
  });

  it('путь к файлу SQLite вместо Postgres — «На Vercel нужен Postgres»', () => {
    expect(() => loadConfig({ ...vercel, DATABASE_URL: 'data/app.db' })).toThrow('На Vercel нужен Postgres');
  });

  it('адрес — из VERCEL_PROJECT_PRODUCTION_URL, разрешены и адреса развёртывания; данные — во временной папке, не в data/', () => {
    const c = loadConfig({ ...vercel, VERCEL_PROJECT_PRODUCTION_URL: 'finmap.vercel.app', VERCEL_URL: 'finmap-abc123.vercel.app', VERCEL_BRANCH_URL: 'finmap-git-dev.vercel.app' });
    expect(c.deployMode).toBe('vercel');
    expect(c.publicUrl).toBe('https://finmap.vercel.app');
    expect(c.allowedOrigins).toEqual(['https://finmap.vercel.app', 'https://finmap-abc123.vercel.app', 'https://finmap-git-dev.vercel.app']);
    expect(c.db).toEqual({ kind: 'neon', url: vercel.DATABASE_URL });
    expect(c.cronSecret).toBe(vercel.CRON_SECRET);
    expect(c.blobToken).toBe(vercel.BLOB_READ_WRITE_TOKEN);
    expect(c.dataDir.startsWith(os.tmpdir())).toBe(true);
  });

  it('вне vercel секреты Vercel не нужны и не попадают в конфиг', () => {
    const c = loadConfig(base);
    expect(c.cronSecret).toBeNull();
    expect(c.blobToken).toBeNull();
  });
});
