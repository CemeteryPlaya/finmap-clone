import fs from 'node:fs';

export class LockHeldError extends Error {
  constructor(public readonly pid: number) {
    super(`Приложение уже запущено (PID ${pid}). Остановите его и повторите.`);
    this.name = 'LockHeldError';
  }
}

export function isPidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return (e as NodeJS.ErrnoException).code === 'EPERM';
  }
}

export function readLockPid(lockPath: string): number | null {
  try {
    const pid = Number.parseInt(fs.readFileSync(lockPath, 'utf8').trim(), 10);
    return Number.isFinite(pid) ? pid : null;
  } catch {
    return null;
  }
}

export function isLockHeld(lockPath: string): boolean {
  const pid = readLockPid(lockPath);
  return pid !== null && pid !== process.pid && isPidAlive(pid);
}

export function acquireLock(lockPath: string): () => void {
  const pid = readLockPid(lockPath);
  if (pid !== null && pid !== process.pid && isPidAlive(pid)) throw new LockHeldError(pid);
  fs.writeFileSync(lockPath, String(process.pid));
  return () => {
    if (readLockPid(lockPath) === process.pid) fs.rmSync(lockPath, { force: true });
  };
}
