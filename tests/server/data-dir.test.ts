import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { ensureDataDir } from '../../src/server/data-dir';
import { icaclsRestrictArgs } from '../../scripts/lib/windows-acl';

let dir = '';
afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

describe('ensureDataDir', () => {
  it('создаёт вложенную папку; на Linux ставит права 0700', () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fc-datadir-'));
    const target = path.join(dir, 'a', 'data');
    const calls: Array<[string, number]> = [];
    ensureDataDir(target, { platform: 'linux', chmod: (p, m) => calls.push([p, m]) });
    expect(fs.statSync(target).isDirectory()).toBe(true);
    expect(calls).toEqual([[target, 0o700]]);
  });

  it('на Windows права не трогает; повторный вызов не падает', () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fc-datadir-'));
    const calls: unknown[] = [];
    ensureDataDir(dir, { platform: 'win32', chmod: () => calls.push(1) });
    ensureDataDir(dir, { platform: 'win32', chmod: () => calls.push(1) });
    expect(calls).toEqual([]);
  });

  it('папка чужая и chmod падает (EPERM) — предупреждение, а не ошибка запуска', () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fc-datadir-'));
    const warnings: string[] = [];
    expect(() =>
      ensureDataDir(dir, {
        platform: 'linux',
        chmod: () => {
          throw Object.assign(new Error('EPERM: operation not permitted'), { code: 'EPERM' });
        },
        warn: (m) => warnings.push(m),
      }),
    ).not.toThrow();
    expect(warnings).toEqual([expect.stringMatching(/Не удалось закрыть папку данных .*EPERM/)]);
  });

  it.skipIf(process.platform === 'win32')('на POSIX права действительно 0700', () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fc-datadir-'));
    fs.chmodSync(dir, 0o755);
    ensureDataDir(dir);
    expect(fs.statSync(dir).mode & 0o777).toBe(0o700);
  });
});

describe('icaclsRestrictArgs (Windows: папка данных и файл настроек)', () => {
  it('папка: наследование выключено, полный доступ — только текущему пользователю, SYSTEM и Администраторам, с наследованием вниз', () => {
    expect(icaclsRestrictArgs('C:\\Users\\Админ\\Учёт\\data', 'CLUB-PC\\Админ', 'dir')).toEqual([
      'C:\\Users\\Админ\\Учёт\\data',
      '/inheritance:r',
      '/grant:r',
      'CLUB-PC\\Админ:(OI)(CI)F',
      '*S-1-5-18:(OI)(CI)F',
      '*S-1-5-32-544:(OI)(CI)F',
    ]);
  });

  it('файл: те же три владельца без флагов наследования; SID вместо локализованных имён групп', () => {
    expect(icaclsRestrictArgs('C:\\Учёт\\.env', 'PC\\User', 'file')).toEqual([
      'C:\\Учёт\\.env',
      '/inheritance:r',
      '/grant:r',
      'PC\\User:F',
      '*S-1-5-18:F',
      '*S-1-5-32-544:F',
    ]);
  });
});
