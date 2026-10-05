import type { EventEmitter } from 'node:events';

/** Минимальный интерфейс дочернего процесса (ChildProcess ему удовлетворяет). */
export interface ChildLike extends EventEmitter {
  pid?: number;
  connected?: boolean;
  kill(signal?: NodeJS.Signals | number): boolean;
  send?(message: unknown): boolean;
}

export interface SupervisorOptions {
  /** Завершает процесс супервизора (в тестах подменяется). */
  exit: (code: number) => void;
  graceMs?: number;
  platform?: NodeJS.Platform;
  setTimer?: (fn: () => void, ms: number) => unknown;
  clearTimer?: (handle: unknown) => void;
  now?: () => number;
  logError?: (message: string) => void;
}

export interface SuperviseOptions {
  /** Ребёнок запущен с IPC-каналом: остановку просим сообщением { type: 'shutdown' }. */
  ipc?: boolean;
  /** Вернуть false, чтобы не перезапускать (например, блокировка занята). */
  onExit?: (code: number | null) => boolean;
}

export function createSupervisor(o: SupervisorOptions) {
  const graceMs = o.graceMs ?? 11_000;
  const platform = o.platform ?? process.platform;
  const setTimer = o.setTimer ?? ((fn, ms) => setTimeout(fn, ms));
  const clearTimer = o.clearTimer ?? ((h) => clearTimeout(h as NodeJS.Timeout));
  const now = o.now ?? Date.now;
  const logError = o.logError ?? ((m) => console.error(m));

  let shuttingDown = false;
  let shutdownPromise: Promise<void> | null = null;
  let onDrain: (() => void) | null = null;
  const children = new Set<ChildLike>();
  const ipcChildren = new Set<ChildLike>();
  const restartTimers = new Set<unknown>();

  function supervise(name: string, start: () => ChildLike, opts: SuperviseOptions = {}): void {
    let delay = 1000;

    const launch = (): void => {
      if (shuttingDown) return;
      const startedAt = now();
      let ended = false;
      let child: ChildLike | undefined;

      const end = (code: number | null): void => {
        if (ended) return;
        ended = true;
        if (child) {
          children.delete(child);
          ipcChildren.delete(child);
        }
        onDrain?.();
        if (shuttingDown) return;
        if (opts.onExit && !opts.onExit(code)) return;
        if (now() - startedAt > 60_000) delay = 1000;
        logError(`[${name}] завершился с кодом ${code}; перезапуск через ${delay / 1000} с`);
        let handle: unknown;
        handle = setTimer(() => {
          restartTimers.delete(handle);
          launch();
        }, delay);
        restartTimers.add(handle);
        delay = Math.min(delay * 2, 60_000);
      };

      try {
        child = start();
      } catch (e) {
        logError(`[${name}] не удалось запустить: ${(e as Error).message}`);
        end(null);
        return;
      }
      const c = child;
      children.add(c);
      if (opts.ipc) ipcChildren.add(c);
      c.on('exit', (code: number | null) => end(code));
      c.on('error', (e: Error) => {
        logError(`[${name}] ошибка процесса: ${e.message}`);
        // Если процесс так и не стартовал, 'exit' не придёт — считаем его завершившимся.
        if (c.pid === undefined) end(null);
      });
    };
    launch();
  }

  function killAll(): void {
    for (const c of children) {
      try {
        c.kill('SIGKILL');
      } catch {
        /* уже завершился */
      }
    }
  }

  /**
   * Останавливает всех детей и затем вызывает exit(code).
   * fromConsole: остановка вызвана консольным событием (Ctrl+C/Ctrl+Break) — в Windows оно уже
   * дошло до всех процессов консоли, поэтому TerminateProcess не нужен.
   */
  function shutdown(code = 0, opts: { fromConsole?: boolean } = {}): Promise<void> {
    if (shutdownPromise) return shutdownPromise;
    shuttingDown = true;
    for (const h of restartTimers) clearTimer(h);
    restartTimers.clear();

    shutdownPromise = new Promise<void>((resolve) => {
      let done = false;
      let graceTimer: unknown;
      const finish = (force: boolean): void => {
        if (done) return;
        done = true;
        onDrain = null;
        clearTimer(graceTimer);
        if (force) killAll();
        o.exit(code);
        resolve();
      };

      for (const c of children) {
        if (ipcChildren.has(c) && c.connected && c.send) {
          try {
            c.send({ type: 'shutdown' });
          } catch {
            c.kill('SIGTERM');
          }
        } else if (platform !== 'win32' || !opts.fromConsole) {
          c.kill('SIGTERM');
        }
      }

      if (children.size === 0) return finish(false);
      onDrain = () => {
        if (children.size === 0) finish(false);
      };
      graceTimer = setTimer(() => finish(true), graceMs);
    });
    return shutdownPromise;
  }

  return {
    supervise,
    shutdown,
    killAll,
    isShuttingDown: () => shuttingDown,
    childCount: () => children.size,
  };
}
