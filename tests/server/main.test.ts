import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { isWildcardHost, startServer } from '../../src/server/main';
import { currentBootTime, LockHeldError } from '../../src/server/lock';
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
      const lock = JSON.parse(fs.readFileSync(config.lockPath, 'utf8')) as { pid: number; bootTime: number };
      expect(Object.keys(lock).sort()).toEqual(['bootTime', 'pid']);
      expect(lock.pid).toBe(process.pid);
      expect(Math.abs(lock.bootTime - currentBootTime())).toBeLessThanOrEqual(2);
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

  it('stop() при повторном вызове возвращает тот же промис и завершает очистку', async () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fc-main-'));
    const config = testConfig(dir, { PORT: '0' });
    const s = await startServer(config, { logger: false, handleSignals: false });
    const p1 = s.stop();
    const p2 = s.stop();
    await Promise.all([p1, p2]);
    expect(fs.existsSync(config.lockPath)).toBe(false);
    await expect(fetch(`${s.url}/api/v1/health`)).rejects.toThrow();
  });

  it('при сбое старта освобождает lock и закрывает БД, пробрасывая исходную ошибку', async () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fc-main-'));
    const blocker = net.createServer();
    await new Promise<void>((r) => blocker.listen(0, '127.0.0.1', r));
    try {
      const busyPort = (blocker.address() as net.AddressInfo).port;
      const config = testConfig(dir, { PORT: String(busyPort) });
      await expect(startServer(config, { logger: false, handleSignals: false })).rejects.toMatchObject({ code: 'EADDRINUSE' });
      expect(fs.existsSync(config.lockPath)).toBe(false);
    } finally {
      await new Promise((r) => blocker.close(r));
    }
  });
});

describe('isWildcardHost', () => {
  it('0.0.0.0, :: и пустая строка — все интерфейсы (предупреждение о LAN)', () => {
    expect(isWildcardHost('0.0.0.0')).toBe(true);
    expect(isWildcardHost('::')).toBe(true);
    expect(isWildcardHost('')).toBe(true);
    expect(isWildcardHost('127.0.0.1')).toBe(false);
    expect(isWildcardHost('192.168.1.10')).toBe(false);
  });
});
