import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { acquireLock, isLockHeld, LockHeldError, readLockPid } from '../../src/server/lock';

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
});
