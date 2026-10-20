import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { EventEmitter } from 'node:events';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { isWildcardHost, startServer } from '../../src/server/main';
import { currentBootTime, LockHeldError, LockSuspectError } from '../../src/server/lock';
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

  it('Postgres и режим vercel — не для npm start: понятная ошибка до создания папок и lock (план 2026-10-20-vercel-postgres)', async () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fc-main-'));
    const pg = testConfig(dir, { PORT: '0', DATABASE_URL: 'postgres://u:p@h/db' });
    await expect(startServer(pg, { logger: false, handleSignals: false })).rejects.toThrow('npm start работает с базой SQLite');
    const vercel = { ...testConfig(dir, { PORT: '0' }), deployMode: 'vercel' as const };
    await expect(startServer(vercel, { logger: false, handleSignals: false })).rejects.toThrow('режим vercel запускается на Vercel');
    expect(fs.existsSync(pg.lockPath)).toBe(false);
  });

  it('не стартует второй экземпляр при живом lock', async () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fc-main-'));
    const config = testConfig(dir, { PORT: '0' });
    fs.mkdirSync(config.dataDir, { recursive: true });
    fs.writeFileSync(config.lockPath, String(process.ppid));
    await expect(startServer(config, { logger: false, handleSignals: false, isNode: () => true })).rejects.toBeInstanceOf(LockHeldError);
  });

  it('скачок часов: живой lock с другим bootTime и занятый порт — второй экземпляр не стартует, lock не тронут', async () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fc-main-'));
    const blocker = net.createServer();
    await new Promise<void>((r) => blocker.listen(0, '127.0.0.1', r));
    try {
      const port = (blocker.address() as net.AddressInfo).port;
      const config = testConfig(dir, { PORT: String(port) });
      fs.mkdirSync(config.dataDir, { recursive: true });
      const suspect = JSON.stringify({ pid: process.ppid, bootTime: currentBootTime() - 3600 });
      fs.writeFileSync(config.lockPath, suspect);
      const err = await startServer(config, { logger: false, handleSignals: false, isNode: () => true }).then(
        () => null,
        (e: unknown) => e,
      );
      expect(err).toBeInstanceOf(LockSuspectError);
      expect(err).toBeInstanceOf(LockHeldError);
      expect((err as Error).message).toContain(`Порт ${port} занят`);
      expect(fs.readFileSync(config.lockPath, 'utf8')).toBe(suspect);
    } finally {
      await new Promise<void>((r) => blocker.close(() => r()));
    }
  });

  it('после перезагрузки: живой lock с другим bootTime и свободный порт — lock перехватывается', async () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fc-main-'));
    const config = testConfig(dir, { PORT: '0' });
    fs.mkdirSync(config.dataDir, { recursive: true });
    fs.writeFileSync(config.lockPath, JSON.stringify({ pid: process.ppid, bootTime: currentBootTime() - 3600 }));
    const s = await startServer(config, { logger: false, handleSignals: false, isNode: () => true });
    try {
      expect((JSON.parse(fs.readFileSync(config.lockPath, 'utf8')) as { pid: number }).pid).toBe(process.pid);
    } finally {
      await s.stop();
    }
  });

  it('lock с PID чужого процесса (не node) не мешает старту', async () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fc-main-'));
    const config = testConfig(dir, { PORT: '0' });
    fs.mkdirSync(config.dataDir, { recursive: true });
    fs.writeFileSync(config.lockPath, String(process.ppid));
    const s = await startServer(config, { logger: false, handleSignals: false, isNode: () => false });
    await s.stop();
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

class FakeProc extends EventEmitter {
  constructor(
    public send?: (m: unknown) => boolean,
    public connected = true,
  ) {
    super();
  }
}

describe('startServer: остановка по IPC/сигналам', () => {
  it('слушатели регистрируются сразу: запрос остановки во время запуска выполняется после старта', async () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fc-main-'));
    const config = testConfig(dir, { PORT: '0' });
    const proc = new FakeProc(() => true);
    const exit = vi.fn();
    const pending = startServer(config, { logger: false, proc, exit });
    // Запуск ещё идёт (миграции, бэкап, listen), а супервизор уже просит остановиться.
    expect(proc.listenerCount('message')).toBe(1);
    expect(proc.listenerCount('disconnect')).toBe(1);
    expect(proc.listenerCount('SIGINT')).toBe(1);
    proc.emit('message', { type: 'shutdown' });
    const s = await pending;
    await vi.waitFor(() => expect(exit).toHaveBeenCalledWith(0));
    expect(fs.existsSync(config.lockPath)).toBe(false);
    await expect(fetch(`${s.url}/api/v1/health`)).rejects.toThrow();
  });

  it('IPC-канал уже закрыт к моменту регистрации — сервер останавливается после старта', async () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fc-main-'));
    const config = testConfig(dir, { PORT: '0' });
    const proc = new FakeProc(() => true, false);
    const exit = vi.fn();
    await startServer(config, { logger: false, proc, exit });
    await vi.waitFor(() => expect(exit).toHaveBeenCalledWith(0));
    expect(fs.existsSync(config.lockPath)).toBe(false);
  });

  it('disconnect после старта останавливает сервер и снимает lock', async () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fc-main-'));
    const config = testConfig(dir, { PORT: '0' });
    const proc = new FakeProc(() => true);
    const exit = vi.fn();
    await startServer(config, { logger: false, proc, exit });
    expect(exit).not.toHaveBeenCalled();
    expect(fs.existsSync(config.lockPath)).toBe(true);
    proc.emit('disconnect');
    await vi.waitFor(() => expect(exit).toHaveBeenCalledWith(0));
    expect(fs.existsSync(config.lockPath)).toBe(false);
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
