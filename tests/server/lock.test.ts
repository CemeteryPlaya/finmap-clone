import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { acquireLock, currentBootTime, isLockHeld, LockHeldError, readLockPid } from '../../src/server/lock';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fc-lock-'));
const lock = path.join(dir, 'app.lock');
afterEach(() => fs.rmSync(lock, { force: true }));

describe('lock', () => {
  it('берёт и снимает lock', () => {
    const release = acquireLock(lock);
    expect(readLockPid(lock)).toBe(process.pid);
    release();
    expect(fs.existsSync(lock)).toBe(false);
  });

  it('второй экземпляр не стартует, пока жив процесс-владелец', () => {
    fs.writeFileSync(lock, String(process.ppid)); // живой процесс (родитель vitest-воркера)
    expect(isLockHeld(lock)).toBe(true);
    expect(() => acquireLock(lock)).toThrow(LockHeldError);
  });

  it('перехватывает устаревший lock мёртвого процесса', () => {
    fs.writeFileSync(lock, '999999');
    expect(isLockHeld(lock)).toBe(false);
    const release = acquireLock(lock);
    expect(readLockPid(lock)).toBe(process.pid);
    release();
  });

  it('пишет lock в формате JSON { pid, bootTime }', () => {
    const release = acquireLock(lock);
    const data = JSON.parse(fs.readFileSync(lock, 'utf8')) as { pid: number; bootTime: number };
    expect(data.pid).toBe(process.pid);
    expect(Math.abs(data.bootTime - currentBootTime())).toBeLessThanOrEqual(2);
    release();
  });

  it('lock живого PID с текущим bootTime блокирует запуск; сообщение называет файл lock', () => {
    fs.writeFileSync(lock, JSON.stringify({ pid: process.ppid, bootTime: currentBootTime() }));
    expect(isLockHeld(lock)).toBe(true);
    let err: unknown;
    try {
      acquireLock(lock);
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(LockHeldError);
    expect((err as Error).message).toContain(lock);
    expect((err as Error).message).toMatch(/удал/i);
  });

  it('lock живого PID из прошлой загрузки системы (другой bootTime) устарел и перехватывается', () => {
    fs.writeFileSync(lock, JSON.stringify({ pid: process.ppid, bootTime: currentBootTime() - 3600 }));
    expect(isLockHeld(lock)).toBe(false);
    const release = acquireLock(lock);
    expect(readLockPid(lock)).toBe(process.pid);
    release();
  });

  it('старый формат (только PID): файл старше загрузки системы устарел, даже если PID жив', () => {
    fs.writeFileSync(lock, String(process.ppid));
    const beforeBoot = new Date((currentBootTime() - 3600) * 1000);
    fs.utimesSync(lock, beforeBoot, beforeBoot);
    expect(isLockHeld(lock)).toBe(false);
    const release = acquireLock(lock);
    expect(readLockPid(lock)).toBe(process.pid);
    release();
  });
});
