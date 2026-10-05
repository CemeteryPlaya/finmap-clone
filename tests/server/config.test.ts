import { describe, expect, it } from 'vitest';
import path from 'node:path';
import { loadConfig } from '../../src/server/config';

const base = { SESSION_SECRET: 'x'.repeat(32) };

describe('loadConfig', () => {
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

  it('учитывает DATA_DIR для всех путей данных', () => {
    const c = loadConfig({ ...base, DATA_DIR: 'tmp/x' });
    expect(c.dbPath).toBe(path.resolve('tmp/x', 'app.db'));
    expect(c.uploadsDir).toBe(path.resolve('tmp/x', 'uploads'));
    expect(c.backupsDir).toBe(path.resolve('tmp/x', 'backups'));
    expect(c.binDir).toBe(path.resolve('tmp/x', 'bin'));
  });
});
