export interface StopDeps {
  /** PID работающего супервизора (data/supervisor.lock) или null. */
  supervisorPid: number | null;
  /** PID работающего сервера (data/app.lock) или null. */
  serverPid: number | null;
  isAlive: (pid: number) => boolean;
  /** Создать заявку на остановку (data/stop.request). */
  requestStop: () => void;
  /** Убрать заявку, которую никто не забрал. */
  clearRequest: () => void;
  /** Принудительно завершить процесс (на Windows — вместе с дочерними). */
  forceKill: (pid: number) => void;
  /** Можно ли принудительно завершить этот PID (по умолчанию — да). */
  canForceKill?: (pid: number) => boolean;
  sleep: (ms: number) => Promise<void>;
  now: () => number;
  /** Сколько ждать мягкой остановки, мс (по умолчанию 20 000). */
  timeoutMs?: number;
  /** Сколько ждать исчезновения процессов после принудительного завершения, мс (по умолчанию 5 000). */
  killWaitMs?: number;
}

/**
 * not-running — ничего не запущено; stopped — остановлено по заявке; killed — супервизор не ответил,
 * завершён принудительно; killed-server — сервер без супервизора (npm run dev) завершён принудительно;
 * failed — процесс жив и после принудительного завершения.
 */
export type StopResult = 'not-running' | 'stopped' | 'killed' | 'killed-server' | 'failed';

/**
 * Остановка приложения (§9.3: перед восстановлением и обновлением). Сначала мягко — заявкой,
 * которую супервизор забирает раз в секунду и останавливает сервер штатно (БД закрыта, lock снят).
 * Если за timeoutMs процессы не завершились — принудительно (WAL сохраняет согласованность, §9.1),
 * затем проверка, что процессов больше нет. Процесс, не подтверждённый как наш (canForceKill), не трогаем.
 */
export async function stopApp(d: StopDeps): Promise<StopResult> {
  const { supervisorPid: sup, serverPid: srv } = d;
  if (sup === null && srv === null) return 'not-running';
  const alive = (pid: number | null): pid is number => pid !== null && d.isAlive(pid);
  const gone = () => !alive(sup) && !alive(srv);

  if (sup !== null) {
    d.requestStop();
    const deadline = d.now() + (d.timeoutMs ?? 20_000);
    while (d.now() < deadline) {
      if (gone()) return 'stopped';
      await d.sleep(500);
    }
    if (gone()) return 'stopped';
    d.clearRequest();
  }
  for (const pid of [sup, srv]) if (alive(pid) && (d.canForceKill?.(pid) ?? true)) d.forceKill(pid);
  const killDeadline = d.now() + (d.killWaitMs ?? 5_000);
  while (!gone() && d.now() < killDeadline) await d.sleep(250);
  if (!gone()) return 'failed';
  return sup === null ? 'killed-server' : 'killed';
}

/** Команда принудительного завершения дерева процессов; на POSIX — null (используется SIGKILL). */
export function forceKillCommand(platform: NodeJS.Platform, pid: number): { cmd: string; args: string[] } | null {
  return platform === 'win32' ? { cmd: 'taskkill', args: ['/PID', String(pid), '/T', '/F'] } : null;
}

export const STOP_MESSAGES: Record<StopResult, string> = {
  'not-running': 'Приложение не запущено.',
  stopped: 'Приложение остановлено.',
  killed:
    'Приложение не ответило за 20 секунд и остановлено принудительно. База осталась согласованной; ' +
    'могли не сохраниться только изменения, которые выполнялись в эту секунду.',
  'killed-server': 'Сервер, запущенный без супервизора (например npm run dev), остановлен принудительно.',
  failed: 'Не удалось остановить приложение даже принудительно. Перезагрузите компьютер и повторите.',
};
