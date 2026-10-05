import fs from 'node:fs';
import os from 'node:os';

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

function heldByOther(info: LockInfo | null): info is LockInfo {
  return info !== null && info.pid !== process.pid && !isStale(info);
}

export function isLockHeld(lockPath: string): boolean {
  return heldByOther(readLock(lockPath));
}

export function acquireLock(lockPath: string): () => void {
  const info = readLock(lockPath);
  if (heldByOther(info)) throw new LockHeldError(info.pid, lockPath);
  fs.writeFileSync(lockPath, JSON.stringify({ pid: process.pid, bootTime: currentBootTime() }));
  return () => {
    if (readLockPid(lockPath) === process.pid) fs.rmSync(lockPath, { force: true });
  };
}
