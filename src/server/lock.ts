import { spawnSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';

/** Допуск при сравнении времени загрузки системы (uptime и часы дают погрешность). */
const BOOT_TOLERANCE_S = 60;

export class LockHeldError extends Error {
  constructor(
    public readonly pid: number,
    public readonly lockPath: string,
  ) {
    super(
      `Приложение уже запущено (PID ${pid}, файл блокировки ${lockPath}). Остановите его и повторите. ` +
        `Если приложение точно не запущено, удалите файл ${lockPath}.`,
    );
    this.name = 'LockHeldError';
  }
}

/**
 * В app.lock живой PID из другой загрузки системы, и порт приложения занят. Это либо скачок часов при
 * работающем приложении, либо после перезагрузки порт занят чужой программой (а PID достался другому
 * процессу). Супервизор в этом случае не сдаётся, а повторяет запуск с паузой.
 */
export class LockSuspectError extends LockHeldError {
  constructor(pid: number, lockPath: string, port: number) {
    super(pid, lockPath);
    this.message =
      `Порт ${port} занят, а в файле блокировки ${lockPath} — живой процесс PID ${pid} из прошлой загрузки системы. ` +
      'Либо приложение уже запущено (сдвинулись часы), либо порт занят другой программой.';
    this.name = 'LockSuspectError';
  }
}

/** Время загрузки системы, в секундах Unix. */
export function currentBootTime(): number {
  return Math.round((Date.now() - os.uptime() * 1000) / 1000);
}

export function isPidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return (e as NodeJS.ErrnoException).code === 'EPERM';
  }
}

/** Разбор вывода `tasklist /FO CSV /NH`: первая строка с кавычки, первое поле — имя образа. */
export function imageIsNodeFromTasklist(csv: string): boolean {
  const line = csv.split(/\r?\n/).find((l) => l.startsWith('"'));
  if (!line) return false;
  const image = /^"([^"]*)"/.exec(line)?.[1] ?? '';
  return image.toLowerCase() === 'node.exe';
}

/** Проверка образа процесса: true/false — проверено; null — проверить не удалось. */
export type IsNodeProcess = (pid: number) => boolean | null;

/**
 * Это процесс node? true/false — проверено; null — проверить не удалось.
 * Windows: tasklist /FI "PID eq N" /FO CSV /NH (первое поле — имя образа, node.exe);
 * Linux: /proc/N/comm («node» или «nodejs»). Другие системы — null. Не бросает исключений.
 */
export function processImageIsNode(pid: number): boolean | null {
  try {
    if (process.platform === 'win32') {
      const tasklist = path.join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'tasklist.exe');
      const r = spawnSync(tasklist, ['/FI', `PID eq ${pid}`, '/FO', 'CSV', '/NH'], {
        encoding: 'utf8',
        windowsHide: true,
        timeout: 5000,
      });
      if (r.error || r.status !== 0 || typeof r.stdout !== 'string') return null;
      return imageIsNodeFromTasklist(r.stdout);
    }
    if (process.platform === 'linux') {
      try {
        const comm = fs.readFileSync(`/proc/${pid}/comm`, 'utf8').trim();
        return comm === 'node' || comm === 'nodejs';
      } catch (e) {
        return (e as NodeJS.ErrnoException).code === 'ENOENT' ? false : null;
      }
    }
    return null;
  } catch {
    return null;
  }
}

interface LockInfo {
  pid: number;
  /** null — старый формат (в файле только PID). */
  bootTime: number | null;
  mtimeMs: number;
}

function readLock(lockPath: string): LockInfo | null {
  try {
    const text = fs.readFileSync(lockPath, 'utf8').trim();
    const mtimeMs = fs.statSync(lockPath).mtimeMs;
    let pid: unknown;
    let bootTime: number | null = null;
    if (text.startsWith('{')) {
      const data = JSON.parse(text) as { pid?: unknown; bootTime?: unknown };
      pid = data.pid;
      if (typeof data.bootTime === 'number' && Number.isFinite(data.bootTime)) bootTime = data.bootTime;
    } else {
      pid = Number.parseInt(text, 10);
    }
    return typeof pid === 'number' && Number.isInteger(pid) && pid > 0 ? { pid, bootTime, mtimeMs } : null;
  } catch {
    return null;
  }
}

export function readLockPid(lockPath: string): number | null {
  return readLock(lockPath)?.pid ?? null;
}

/**
 * Lock устарел, если записан в прошлую загрузку системы (после перезагрузки PID может принадлежать
 * чужому процессу) или его процесс мёртв.
 */
function isStale(info: LockInfo): boolean {
  const boot = currentBootTime();
  if (info.bootTime !== null) {
    if (Math.abs(info.bootTime - boot) > BOOT_TOLERANCE_S) return true;
  } else if (info.mtimeMs < boot * 1000) {
    return true;
  }
  return !isPidAlive(info.pid);
}

/**
 * Занято другим процессом: жив, из этой загрузки системы и образ не опровергнут как «не node»
 * (PID мог достаться чужому процессу и без перезагрузки — например, после выхода из системы).
 */
function heldByOther(info: LockInfo | null, isNode: IsNodeProcess): info is LockInfo {
  return info !== null && info.pid !== process.pid && !isStale(info) && isNode(info.pid) !== false;
}

/** Блокировка супервизора в папке данных (npm start, npm run stop, restore). */
export const SUPERVISOR_LOCK_FILE = 'supervisor.lock';

/**
 * Состояние lock: free — нет или процесс мёртв (или это мы); held — жив и из этой загрузки системы;
 * suspect — PID жив, но bootTime другой. Это либо перезагрузка (PID достался чужому процессу),
 * либо скачок системных часов больше чем на минуту при работающем приложении — различить можно
 * только по занятому порту приложения и образу процесса (node).
 */
export type LockState = { kind: 'free' } | { kind: 'held'; pid: number } | { kind: 'suspect'; pid: number };

/**
 * Живой PID, образ которого проверен и не node, — не приложение (PID переиспользован), lock устарел.
 * null (проверить не удалось) состояние не меняет. Свой PID не проверяем.
 */
function stateOf(info: LockInfo | null, ownIsFree: boolean, isNode: IsNodeProcess): LockState {
  if (info === null || !isPidAlive(info.pid)) return { kind: 'free' };
  if (info.pid === process.pid) {
    if (ownIsFree) return { kind: 'free' };
  } else if (isNode(info.pid) === false) {
    return { kind: 'free' };
  }
  return isStale(info) ? { kind: 'suspect', pid: info.pid } : { kind: 'held', pid: info.pid };
}

export function lockState(lockPath: string, isNode: IsNodeProcess = processImageIsNode): LockState {
  return stateOf(readLock(lockPath), true, isNode);
}

/** Порт свободен: удалось начать и закончить прослушивание. */
export function isPortFree(host: string, port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const srv = net.createServer();
    srv.once('error', () => resolve(false));
    srv.once('listening', () => srv.close(() => resolve(true)));
    srv.listen(port, host);
  });
}

/**
 * Процесс lock работает: held, либо suspect при занятом порте приложения (скачок часов).
 * PID с образом, проверенным как «не node», считается чужим (lock устарел) в обоих случаях.
 */
export async function lockRunningPid(
  lockPath: string,
  portBusy: () => Promise<boolean>,
  isNode: IsNodeProcess = processImageIsNode,
): Promise<number | null> {
  const s = lockState(lockPath, isNode);
  if (s.kind === 'held') return s.pid;
  if (s.kind === 'suspect' && (await portBusy())) return s.pid;
  return null;
}

/** Файл без разбираемого содержимого моложе этого срока считаем блокировкой, которую пишут прямо сейчас. */
const FRESH_UNPARSEABLE_MS = 5000;

/**
 * Создаёт файл блокировки сразу с содержимым: пишет во временный файл и жёстко связывает его с lockPath
 * (атомарно; EEXIST — занято). Где жёсткие ссылки недоступны (FAT/exFAT) — запасной путь: запись с флагом 'wx'.
 */
function writeExclusive(lockPath: string, token: string): boolean {
  const content = JSON.stringify({ pid: process.pid, bootTime: currentBootTime(), token });
  const tmp = `${lockPath}.${token}.tmp`;
  fs.writeFileSync(tmp, content);
  try {
    fs.linkSync(tmp, lockPath);
    return true;
  } catch (e) {
    const code = (e as NodeJS.ErrnoException).code;
    if (code === 'EEXIST') return false;
    if (code !== 'EPERM' && code !== 'ENOTSUP' && code !== 'ENOSYS') throw e;
  } finally {
    fs.rmSync(tmp, { force: true });
  }
  try {
    fs.writeFileSync(lockPath, content, { flag: 'wx' });
    return true;
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'EEXIST') return false;
    throw e;
  }
}

function isFresh(p: string): boolean {
  try {
    return Date.now() - fs.statSync(p).mtimeMs < FRESH_UNPARSEABLE_MS;
  } catch {
    return false;
  }
}

function readRaw(p: string): string | null {
  try {
    return fs.readFileSync(p, 'utf8');
  } catch {
    return null;
  }
}

/**
 * Атомарная блокировка (супервизор): файл создаётся только если его нет (flag 'wx').
 * Занятый файл перехватывается, только если он устарел: процесс мёртв, либо bootTime другой и
 * (порт приложения свободен или процесс точно не node). Перехват проверяется: файл уносится в сторону
 * переименованием, и если унесли не то, что оценивали (его успел заменить другой процесс), он
 * возвращается. Снятие удаляет файл, только если в нём наш token.
 */
export async function acquireExclusiveLock(
  lockPath: string,
  o: { portBusy: () => Promise<boolean>; token?: string; isNode?: IsNodeProcess },
): Promise<() => void> {
  const token = o.token ?? crypto.randomUUID();
  const isNode = o.isNode ?? processImageIsNode;
  const release = () => {
    try {
      const data = JSON.parse(fs.readFileSync(lockPath, 'utf8')) as { token?: unknown };
      if (data.token === token) fs.rmSync(lockPath, { force: true });
    } catch {
      /* файла нет или он чужой и битый — не трогаем */
    }
  };
  for (let attempt = 0; attempt < 5; attempt++) {
    if (writeExclusive(lockPath, token)) return release;
    const raw = readRaw(lockPath);
    if (raw === null) continue; // исчез между попытками
    // Пустой/битый файл, который только что появился: его пишет другой процесс (или старая версия) — занято.
    if (readLock(lockPath) === null && isFresh(lockPath)) throw new LockHeldError(0, lockPath);
    // Свой PID с чужим token — второй захват в этом же процессе: занято.
    const state = stateOf(readLock(lockPath), false, isNode);
    if (state.kind === 'held' || (state.kind === 'suspect' && (await o.portBusy()))) {
      throw new LockHeldError(state.pid, lockPath);
    }
    const aside = `${lockPath}.${token}.stale`;
    try {
      fs.renameSync(lockPath, aside);
    } catch {
      continue;
    }
    if (readRaw(aside) !== raw) {
      // Унесли свежую блокировку другого процесса — возвращаем её на место (если место ещё свободно).
      try {
        fs.copyFileSync(aside, lockPath, fs.constants.COPYFILE_EXCL);
      } catch {
        /* место уже занято — тот процесс сам разберётся */
      }
      fs.rmSync(aside, { force: true });
      throw new LockHeldError(readLockPid(lockPath) ?? 0, lockPath);
    }
    fs.rmSync(aside, { force: true });
  }
  throw new LockHeldError(readLockPid(lockPath) ?? 0, lockPath);
}

export function isLockHeld(lockPath: string, isNode: IsNodeProcess = processImageIsNode): boolean {
  return heldByOther(readLock(lockPath), isNode);
}

export function acquireLock(lockPath: string, isNode: IsNodeProcess = processImageIsNode): () => void {
  const info = readLock(lockPath);
  if (heldByOther(info, isNode)) throw new LockHeldError(info.pid, lockPath);
  fs.writeFileSync(lockPath, JSON.stringify({ pid: process.pid, bootTime: currentBootTime() }));
  return () => {
    if (readLockPid(lockPath) === process.pid) fs.rmSync(lockPath, { force: true });
  };
}
