import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  acquireExclusiveLock,
  acquireLock,
  currentBootTime,
  imageIsNodeFromTasklist,
  isLockHeld,
  isPortFree,
  LockHeldError,
  lockRunningPid,
  lockState,
  processImageIsNode,
  readLockPid,
} from '../../src/server/lock';

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
    expect(isLockHeld(lock, isNode)).toBe(true);
    expect(() => acquireLock(lock, isNode)).toThrow(LockHeldError);
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
    expect(isLockHeld(lock, isNode)).toBe(true);
    let err: unknown;
    try {
      acquireLock(lock, isNode);
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

const live = (bootShift = 0) => JSON.stringify({ pid: process.ppid, bootTime: currentBootTime() + bootShift });
const busy = async () => true;
const free = async () => false;
// Явные «инспекторы образа», чтобы тесты не зависели от хоста.
const isNode = () => true;
const notNode = () => false;
const unknownImage = () => null;

describe('lockState: скачок часов и перезагрузка', () => {
  it('нет файла, мёртвый PID, свой PID — free; живой из этой загрузки — held', () => {
    expect(lockState(lock)).toEqual({ kind: 'free' });
    fs.writeFileSync(lock, JSON.stringify({ pid: 999999, bootTime: currentBootTime() }));
    expect(lockState(lock)).toEqual({ kind: 'free' });
    fs.writeFileSync(lock, JSON.stringify({ pid: process.pid, bootTime: currentBootTime() }));
    expect(lockState(lock)).toEqual({ kind: 'free' });
    fs.writeFileSync(lock, live());
    expect(lockState(lock, isNode)).toEqual({ kind: 'held', pid: process.ppid });
  });

  it('живой PID с другим bootTime — suspect; работает он, только если порт приложения занят', async () => {
    fs.writeFileSync(lock, live(-3600));
    expect(lockState(lock, isNode)).toEqual({ kind: 'suspect', pid: process.ppid });
    expect(isLockHeld(lock, isNode)).toBe(false);
    expect(await lockRunningPid(lock, busy, isNode)).toBe(process.ppid);
    expect(await lockRunningPid(lock, free, isNode)).toBeNull();
    fs.writeFileSync(lock, live());
    expect(await lockRunningPid(lock, free, isNode)).toBe(process.ppid);
  });

  it('R1: suspect с занятым портом, но процесс не node — не наш, null; образ не определён — считаем работающим', async () => {
    fs.writeFileSync(lock, live(-3600));
    expect(await lockRunningPid(lock, busy, notNode)).toBeNull();
    expect(await lockRunningPid(lock, busy, unknownImage)).toBe(process.ppid);
  });

  it('F1: held с образом, проверенным как не node (PID переиспользован), — free, как и мёртвый PID', async () => {
    fs.writeFileSync(lock, live());
    expect(lockState(lock, notNode)).toEqual({ kind: 'free' });
    expect(await lockRunningPid(lock, free, notNode)).toBeNull();
    fs.writeFileSync(lock, live(-3600));
    expect(lockState(lock, notNode)).toEqual({ kind: 'free' });
  });

  it('F1: образ не определён (null) — held остаётся held, suspect остаётся suspect', async () => {
    fs.writeFileSync(lock, live());
    expect(lockState(lock, unknownImage)).toEqual({ kind: 'held', pid: process.ppid });
    expect(await lockRunningPid(lock, free, unknownImage)).toBe(process.ppid);
    fs.writeFileSync(lock, live(-3600));
    expect(lockState(lock, unknownImage)).toEqual({ kind: 'suspect', pid: process.ppid });
  });

  it('F1: мёртвый PID не проверяется инспектором', () => {
    fs.writeFileSync(lock, JSON.stringify({ pid: 999999, bootTime: currentBootTime() }));
    const spy = vi.fn(() => true);
    expect(lockState(lock, spy)).toEqual({ kind: 'free' });
    expect(isLockHeld(lock, spy)).toBe(false);
    expect(spy).not.toHaveBeenCalled();
  });

  it('F1: свой PID не проверяется инспектором', () => {
    fs.writeFileSync(lock, JSON.stringify({ pid: process.pid, bootTime: currentBootTime() }));
    const spy = vi.fn(() => false);
    expect(lockState(lock, spy)).toEqual({ kind: 'free' });
    expect(spy).not.toHaveBeenCalled();
  });

  it('F1: app.lock с held и не-node PID — isLockHeld false, acquireLock берёт', () => {
    fs.writeFileSync(lock, live());
    expect(isLockHeld(lock, notNode)).toBe(false);
    const release = acquireLock(lock, notNode);
    expect(readLockPid(lock)).toBe(process.pid);
    release();
    fs.writeFileSync(lock, live());
    expect(isLockHeld(lock, unknownImage)).toBe(true);
    expect(() => acquireLock(lock, unknownImage)).toThrow(LockHeldError);
  });
});

describe('imageIsNodeFromTasklist', () => {
  it('разбирает вывод tasklist /FO CSV /NH', () => {
    expect(imageIsNodeFromTasklist('"node.exe","1234","Console","1","50 000 K"\r\n')).toBe(true);
    expect(imageIsNodeFromTasklist('"NODE.EXE","1234","Console","1","50 000 K"')).toBe(true);
    expect(imageIsNodeFromTasklist('"chrome.exe","4321","Console","1","150 000 K"\r\n')).toBe(false);
    expect(imageIsNodeFromTasklist('"node.exe.bak","1","Console","1","1 K"')).toBe(false);
    expect(imageIsNodeFromTasklist('INFO: No tasks are running which match the specified criteria.\r\n')).toBe(false);
    expect(imageIsNodeFromTasklist('ИНФОРМАЦИЯ: задачи, соответствующие указанным критериям, не найдены.')).toBe(false);
    expect(imageIsNodeFromTasklist('')).toBe(false);
  });
});

describe('processImageIsNode', () => {
  it.skipIf(process.platform !== 'win32' && process.platform !== 'linux')('свой процесс — node', () => {
    expect(processImageIsNode(process.pid)).toBe(true);
  });
});

describe('isPortFree', () => {
  it('занятый порт — false, освобождённый — true', async () => {
    const srv = net.createServer();
    await new Promise<void>((r) => srv.listen(0, '127.0.0.1', r));
    const port = (srv.address() as net.AddressInfo).port;
    expect(await isPortFree('127.0.0.1', port)).toBe(false);
    await new Promise<void>((r) => srv.close(() => r()));
    expect(await isPortFree('127.0.0.1', port)).toBe(true);
  });
});

describe('acquireExclusiveLock (блокировка супервизора)', () => {
  it('создаёт файл с pid, bootTime и token; снятие удаляет его', async () => {
    const release = await acquireExclusiveLock(lock, { portBusy: busy, token: 't1' });
    const data = JSON.parse(fs.readFileSync(lock, 'utf8')) as { pid: number; bootTime: number; token: string };
    expect(data).toMatchObject({ pid: process.pid, token: 't1' });
    release();
    expect(fs.existsSync(lock)).toBe(false);
  });

  it('живой владелец из этой загрузки — LockHeldError, файл не тронут', async () => {
    fs.writeFileSync(lock, live());
    await expect(acquireExclusiveLock(lock, { portBusy: free, isNode })).rejects.toBeInstanceOf(LockHeldError);
    expect(fs.readFileSync(lock, 'utf8')).toBe(live());
  });

  it('F1: held, но PID принадлежит не node (переиспользован) — блокировка перехватывается', async () => {
    fs.writeFileSync(lock, live());
    const release = await acquireExclusiveLock(lock, { portBusy: free, isNode: notNode, token: 'mine' });
    expect((JSON.parse(fs.readFileSync(lock, 'utf8')) as { token: string }).token).toBe('mine');
    release();
    expect(fs.readdirSync(dir).filter((f) => f.includes('.stale'))).toEqual([]);
  });

  it('F1: held и образ не определён (null) — занято', async () => {
    fs.writeFileSync(lock, live());
    await expect(acquireExclusiveLock(lock, { portBusy: free, isNode: unknownImage })).rejects.toBeInstanceOf(LockHeldError);
  });

  it('скачок часов: другой bootTime и занятый порт — занято, файл не тронут', async () => {
    const suspect = live(-3600);
    fs.writeFileSync(lock, suspect);
    await expect(acquireExclusiveLock(lock, { portBusy: busy, isNode })).rejects.toBeInstanceOf(LockHeldError);
    expect(fs.readFileSync(lock, 'utf8')).toBe(suspect);
  });

  it('R1: образ не определён (null) — тоже занято, файл не тронут', async () => {
    const suspect = live(-3600);
    fs.writeFileSync(lock, suspect);
    await expect(acquireExclusiveLock(lock, { portBusy: busy, isNode: unknownImage })).rejects.toBeInstanceOf(LockHeldError);
    expect(fs.readFileSync(lock, 'utf8')).toBe(suspect);
  });

  it('R1: suspect, порт занят, но процесс не node — чужой, блокировка перехватывается', async () => {
    fs.writeFileSync(lock, live(-3600));
    const release = await acquireExclusiveLock(lock, { portBusy: busy, isNode: notNode, token: 'mine' });
    expect((JSON.parse(fs.readFileSync(lock, 'utf8')) as { token: string }).token).toBe('mine');
    release();
    expect(fs.existsSync(lock)).toBe(false);
    expect(fs.readdirSync(dir).filter((f) => f.includes('.stale'))).toEqual([]);
  });

  it('после перезагрузки (другой bootTime, порт свободен) и мёртвый PID — перехват', async () => {
    for (const stale of [live(-3600), JSON.stringify({ pid: 999999, bootTime: currentBootTime() })]) {
      fs.writeFileSync(lock, stale);
      const release = await acquireExclusiveLock(lock, { portBusy: free, isNode, token: 'mine' });
      expect((JSON.parse(fs.readFileSync(lock, 'utf8')) as { token: string }).token).toBe('mine');
      release();
      expect(fs.existsSync(lock)).toBe(false);
      expect(fs.readdirSync(dir).filter((f) => f.includes('.stale'))).toEqual([]);
    }
  });

  it('два одновременных захвата устаревшего файла — побеждает один', async () => {
    fs.writeFileSync(lock, JSON.stringify({ pid: 999999, bootTime: currentBootTime() }));
    const results = await Promise.allSettled([
      acquireExclusiveLock(lock, { portBusy: free, token: 'a' }),
      acquireExclusiveLock(lock, { portBusy: free, token: 'b' }),
    ]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect(results.filter((r) => r.status === 'rejected' && r.reason instanceof LockHeldError)).toHaveLength(1);
    for (const r of results) if (r.status === 'fulfilled') r.value();
  });

  it('второй захват в том же процессе — LockHeldError, в файле остаётся token первого', async () => {
    const release = await acquireExclusiveLock(lock, { portBusy: free, token: 'first' });
    await expect(acquireExclusiveLock(lock, { portBusy: free, token: 'second' })).rejects.toBeInstanceOf(LockHeldError);
    expect((JSON.parse(fs.readFileSync(lock, 'utf8')) as { token: string }).token).toBe('first');
    release();
    expect(fs.readdirSync(dir).filter((f) => f.includes('.tmp'))).toEqual([]);
  });

  it('G2: файл с нашим PID и чужим token, который этот процесс не держит (остался от прошлого запуска), — перехват', async () => {
    fs.writeFileSync(lock, JSON.stringify({ pid: process.pid, bootTime: currentBootTime(), token: 'old' }));
    const release = await acquireExclusiveLock(lock, { portBusy: free, isNode, token: 'mine' });
    expect((JSON.parse(fs.readFileSync(lock, 'utf8')) as { token: string }).token).toBe('mine');
    // пока мы держим блокировку, тот же файл с нашим PID — занято
    await expect(acquireExclusiveLock(lock, { portBusy: free, isNode, token: 'third' })).rejects.toBeInstanceOf(LockHeldError);
    release();
    expect(fs.existsSync(lock)).toBe(false);
    expect(fs.readdirSync(dir).filter((f) => f.includes('.stale'))).toEqual([]);
  });

  it('пустой/битый файл моложе 5 с — его пишут прямо сейчас: занято; старый — перехватывается', async () => {
    fs.writeFileSync(lock, '');
    await expect(acquireExclusiveLock(lock, { portBusy: free })).rejects.toBeInstanceOf(LockHeldError);
    expect(fs.readFileSync(lock, 'utf8')).toBe('');
    fs.writeFileSync(lock, '{"pid":');
    await expect(acquireExclusiveLock(lock, { portBusy: free })).rejects.toBeInstanceOf(LockHeldError);
    const old = new Date(Date.now() - 60_000);
    fs.utimesSync(lock, old, old);
    const release = await acquireExclusiveLock(lock, { portBusy: free, token: 'mine' });
    expect((JSON.parse(fs.readFileSync(lock, 'utf8')) as { token: string }).token).toBe('mine');
    release();
  });

  it('снятие не удаляет чужую блокировку (файл перехватил другой процесс)', async () => {
    const release = await acquireExclusiveLock(lock, { portBusy: free, token: 'old' });
    fs.writeFileSync(lock, JSON.stringify({ pid: process.ppid, bootTime: currentBootTime(), token: 'other' }));
    release();
    expect(fs.existsSync(lock)).toBe(true);
  });
});
