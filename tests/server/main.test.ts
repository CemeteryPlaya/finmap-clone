import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { startServer } from '../../src/server/main';
import { LockHeldError } from '../../src/server/lock';
import { testConfig } from '../helpers/test-app';

let dir = '';
afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

describe('startServer', () => {
  it('создаёт папки, мигрирует, сеет валюты, делает стартовый бэкап и слушает порт', async () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fc-main-'));
    const config = testConfig(dir, { PORT: '0' });
    const s = await startServer(config, { logger: false, handleSignals: false });
    try {
      const res = await fetch(`${s.url}/api/v1/health`);
      expect(await res.json()).toEqual({ ok: true });
      expect(fs.readdirSync(config.backupsDir).some((f) => f.startsWith('backup-'))).toBe(true);
      expect(fs.readFileSync(config.lockPath, 'utf8')).toBe(String(process.pid));
    } finally {
      await s.stop();
    }
    expect(fs.existsSync(config.lockPath)).toBe(false);
  });

  it('не стартует второй экземпляр при живом lock', async () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fc-main-'));
    const config = testConfig(dir, { PORT: '0' });
    fs.mkdirSync(config.dataDir, { recursive: true });
    fs.writeFileSync(config.lockPath, String(process.ppid));
    await expect(startServer(config, { logger: false, handleSignals: false })).rejects.toBeInstanceOf(LockHeldError);
  });
});
