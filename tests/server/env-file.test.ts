import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { ENV_TEMPLATE, normalizeHost, parseEnv, updateEnvText, writeEnvFileSecure } from '../../scripts/lib/env-file';

describe('env-file', () => {
  it('парсит KEY=VALUE, игнорирует комментарии и кавычки', () => {
    const m = parseEnv('# c\nA=1\nB="два слова"\n\nC=\n');
    expect([...m]).toEqual([['A', '1'], ['B', 'два слова'], ['C', '']]);
  });

  it('обновляет существующие ключи на месте и дописывает новые, сохраняя комментарии', () => {
    const out = updateEnvText('# Порт\nPORT=3000\nAPP_NAME=Учёт\n', { PORT: '3100', SESSION_SECRET: 'abc' });
    expect(out).toBe('# Порт\nPORT=3100\nAPP_NAME=Учёт\nSESSION_SECRET=abc\n');
  });

  it('ENV_TEMPLATE содержит все ключи и обновляется через updateEnvText', () => {
    const out = updateEnvText(ENV_TEMPLATE, { DEPLOY_MODE: 'ngrok', SESSION_SECRET: 's3' });
    const m = parseEnv(out);
    for (const k of ['APP_NAME', 'APP_TIMEZONE', 'HOST', 'PORT', 'PUBLIC_URL', 'CF_TUNNEL_TOKEN', 'CLOUDFLARED_PATH', 'NGROK_AUTHTOKEN', 'NGROK_DOMAIN', 'EXTRA_ORIGINS', 'BACKUP_KEEP', 'BACKUP_COPY_DIR', 'RATES_SOURCE']) {
      expect(m.has(k)).toBe(true);
    }
    expect(m.get('DEPLOY_MODE')).toBe('ngrok');
    expect(m.get('SESSION_SECRET')).toBe('s3');
    expect(m.get('PORT')).toBe('3000');
  });

  it('normalizeHost убирает схему и хвостовые слэши', () => {
    expect(normalizeHost(' https://fin.example.kz// ')).toBe('fin.example.kz');
    expect(normalizeHost('HTTP://a.b/')).toBe('a.b');
    expect(normalizeHost('  ')).toBe('');
  });

  it('writeEnvFileSecure пишет содержимое атомарно, без временных файлов и с правами 0600 (POSIX)', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fc-envw-'));
    const file = path.join(dir, 'settings');
    fs.writeFileSync(file, 'old', { mode: 0o644 });
    writeEnvFileSecure(file, 'A=1\n');
    expect(fs.readFileSync(file, 'utf8')).toBe('A=1\n');
    expect(fs.readdirSync(dir)).toEqual(['settings']);
    if (process.platform !== 'win32') expect(fs.statSync(file).mode & 0o777).toBe(0o600);
    fs.rmSync(dir, { recursive: true, force: true });
  });
});
