import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { currentBootTime } from '../../src/server/lock';
import { appRunning, appRunningMessage } from '../../scripts/lib/app-running';

let dir = '';
afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

async function freePort(): Promise<number> {
  const srv = net.createServer();
  await new Promise<void>((r) => srv.listen(0, '127.0.0.1', r));
  const port = (srv.address() as net.AddressInfo).port;
  await new Promise<void>((r) => srv.close(() => r()));
  return port;
}

async function withBusyPort<T>(fn: (port: number) => Promise<T>): Promise<T> {
  const srv = net.createServer();
  await new Promise<void>((r) => srv.listen(0, '127.0.0.1', r));
  try {
    return await fn((srv.address() as net.AddressInfo).port);
  } finally {
    await new Promise<void>((r) => srv.close(() => r()));
  }
}

function cfg(port: number) {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fc-running-'));
  return { lockPath: path.join(dir, 'app.lock'), dataDir: dir, host: '127.0.0.1', port };
}

const liveLock = (shift = 0) => JSON.stringify({ pid: process.ppid, bootTime: currentBootTime() + shift });
// Образ родительского процесса зависит от машины (npm, оболочка) — проверку образа подставляем.
const isNode = () => true;

describe('appRunning (проверка перед npm run setup)', () => {
  it('ничего не запущено — null', async () => {
    expect(await appRunning(cfg(await freePort()), { isNode })).toBeNull();
  });

  it('живой lock сервера или супервизора — app', async () => {
    const c = cfg(await freePort());
    fs.writeFileSync(c.lockPath, liveLock());
    expect(await appRunning(c, { isNode })).toBe('app');
    fs.rmSync(c.lockPath);
    fs.writeFileSync(path.join(dir, 'supervisor.lock'), liveLock());
    expect(await appRunning(c, { isNode })).toBe('app');
  });

  it('живой PID, образ которого проверен и не node, — не приложение (PID переиспользован)', async () => {
    const c = cfg(await freePort());
    fs.writeFileSync(c.lockPath, liveLock());
    expect(await appRunning(c, { isNode: () => false })).toBeNull();
  });

  it('порт занят чужой программой, блокировок нет — port-busy, совет сменить PORT', async () => {
    const state = await withBusyPort((port) => appRunning(cfg(port), { isNode }));
    expect(state).toBe('port-busy');
    expect(appRunningMessage('port-busy', 3000)).toMatch(/порт 3000 занят другой программой.*PORT/);
    expect(appRunningMessage('port-busy', 3000)).not.toMatch(/npm run stop/);
    expect(appRunningMessage('app', 3000)).toMatch(/npm run stop/);
  });

  it('скачок часов: lock из прошлой загрузки и занятый порт — app', async () => {
    const state = await withBusyPort(async (port) => {
      const c = cfg(port);
      fs.writeFileSync(c.lockPath, liveLock(-3600));
      return appRunning(c, { isNode });
    });
    expect(state).toBe('app');
  });

  it('lock из прошлой загрузки и свободный порт — приложения нет', async () => {
    const c = cfg(await freePort());
    fs.writeFileSync(c.lockPath, liveLock(-3600));
    expect(await appRunning(c, { isNode })).toBeNull();
  });
});
