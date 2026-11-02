import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { loadConfig } from '../../src/server/config';
import { loadSecrets, phoneMask, SecretsError } from '../../src/server/secrets';

const base = { SESSION_SECRET: 'x'.repeat(32) };
const key64 = crypto.randomBytes(32).toString('base64');

let dir = '';
afterEach(() => {
  if (dir) fs.rmSync(dir, { recursive: true, force: true });
  dir = '';
});
const local = (extra: Record<string, string> = {}) => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fc-secrets-'));
  return loadConfig({ ...base, DATA_DIR: dir, ...extra });
};

/** Секретный ключ, шифрование данных входа Senet и хеш телефона (план 2026-11-02-senet-autopost, задача 3). */
describe('secrets', () => {
  it('seal → open возвращает исходный текст; два seal одного текста различаются', () => {
    const s = loadSecrets(local({ SECRET_KEY: key64 }))!;
    const a = s.seal('пароль-1');
    expect(s.open(a)).toBe('пароль-1');
    expect(s.seal('пароль-1')).not.toBe(a);
    expect(a).not.toContain('пароль');
  });

  it('подменённый байт и чужой ключ — SecretsError undecryptable', () => {
    const s = loadSecrets(local({ SECRET_KEY: key64 }))!;
    const sealed = Buffer.from(s.seal('токен'), 'base64');
    sealed[sealed.length - 1]! ^= 1;
    expect(() => s.open(sealed.toString('base64'))).toThrow(SecretsError);
    const other = loadSecrets(local({ SECRET_KEY: crypto.randomBytes(32).toString('base64') }))!;
    try {
      other.open(s.seal('токен'));
      expect.unreachable();
    } catch (e) {
      expect((e as SecretsError).code).toBe('undecryptable');
    }
  });

  it('локально: без файла и create=false — null; create=true создаёт data/secret.key (32 байта), второй вызов читает его же', () => {
    const config = local();
    expect(loadSecrets(config)).toBeNull();
    const a = loadSecrets(config, { create: true })!;
    const file = path.join(config.dataDir, 'secret.key');
    expect(fs.readFileSync(file).length).toBe(32);
    const b = loadSecrets(config)!;
    expect(b.open(a.seal('x'))).toBe('x');
  });

  it('vercel без SECRET_KEY — null даже с create=true (файловая система временная)', () => {
    const config = loadConfig({
      ...base,
      DEPLOY_MODE: 'vercel',
      DATABASE_URL: 'postgres://u:p@ep-x.neon.tech/db',
      CRON_SECRET: 'c'.repeat(16),
      BLOB_READ_WRITE_TOKEN: 'vercel_blob_rw_x',
    });
    expect(loadSecrets(config, { create: true })).toBeNull();
    expect(loadSecrets({ ...config, secretKey: key64 })).not.toBeNull();
  });

  it('phoneHash: одинаков для разных записей одного номера, не содержит цифр номера открыто', () => {
    const s = loadSecrets(local({ SECRET_KEY: key64 }))!;
    const h = s.phoneHash('+7 701 234 56 12');
    expect(s.phoneHash('87012345612')).toBe(h);
    expect(s.phoneHash('77012345612')).toBe(h);
    expect(s.phoneHash('+77012345613')).not.toBe(h);
    expect(h).toMatch(/^[0-9a-f]{64}$/);
  });

  it('phoneMask: «+7 *** ** 12»; меньше двух цифр — «—»', () => {
    expect(phoneMask('+77012345612')).toBe('+7 *** ** 12');
    expect(phoneMask('8 701 234 56 07')).toBe('+7 *** ** 07');
    expect(phoneMask('5')).toBe('—');
    expect(phoneMask('')).toBe('—');
  });

  it('SECRET_KEY не base64 32 байта — ошибка конфигурации', () => {
    expect(() => loadConfig({ ...base, SECRET_KEY: 'short' })).toThrow('SECRET_KEY — 32 байта в base64');
    expect(() => loadConfig({ ...base, SECRET_KEY: crypto.randomBytes(16).toString('base64') })).toThrow('SECRET_KEY — 32 байта в base64');
    expect(loadConfig({ ...base, SECRET_KEY: key64 }).secretKey).toBe(key64);
    expect(loadConfig(base).secretKey).toBeNull();
  });
});
