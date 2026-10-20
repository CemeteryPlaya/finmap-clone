import fs from 'node:fs';
import type { FastifyInstance, FastifyServerOptions } from 'fastify';
import { buildApp } from './app';
import type { Config } from './config';
import { ensureDataDir } from './data-dir';
import { openDb, type Sqlite } from './db/client';
import { migrateWithBackup } from './db/migrate';
import { seedCurrencies } from './db/seed';
import { inLine } from './db/tx';
import { startScheduler } from './jobs/scheduler';
import { acquireLock, isPortFree, lockState, LockSuspectError, type IsNodeProcess } from './lock';
import { createLoggerOptions } from './logger';
import { createBackupService } from './modules/backup/service';

export { EXIT_LOCK_HELD, EXIT_LOCK_SUSPECT } from './exit-codes';

/** Адрес, при котором сервер слушает все интерфейсы ('' Fastify трактует как '::'). */
export function isWildcardHost(host: string): boolean {
  return host === '0.0.0.0' || host === '::' || host === '';
}

export interface RunningServer {
  app: FastifyInstance;
  url: string;
  stop(): Promise<void>;
}

/** Источник сигналов и IPC-сообщений (process; в тестах — подделка). */
export interface ProcLike {
  on(event: string, listener: (...args: any[]) => void): unknown;
  send?: unknown;
  connected?: boolean;
}

export interface StartOptions {
  logger?: FastifyServerOptions['logger'];
  handleSignals?: boolean;
  proc?: ProcLike;
  exit?: (code: number) => void;
  /** Проверка образа процесса владельца блокировки (для тестов). */
  isNode?: IsNodeProcess;
}

export async function startServer(config: Config, opts: StartOptions = {}): Promise<RunningServer> {
  ensureDataDir(config.dataDir);
  for (const d of [config.uploadsDir, config.backupsDir, config.logsDir]) fs.mkdirSync(d, { recursive: true });
  // Живой PID с чужим bootTime: перезагрузка (PID занят другим процессом) или скачок часов при
  // работающем приложении. Во втором случае порт занят — тогда lock не перехватываем.
  const state = lockState(config.lockPath, opts.isNode);
  if (state.kind === 'suspect' && !(await isPortFree(config.host, config.port))) {
    throw new LockSuspectError(state.pid, config.lockPath, config.port);
  }
  const releaseLock = acquireLock(config.lockPath, opts.isNode);
  const exit = opts.exit ?? ((code: number) => process.exit(code));

  // Слушатели остановки — сразу после lock, до долгого запуска: если супервизор исчезнет или попросит
  // остановиться во время миграций/бэкапа, остановка выполнится, как только запуск завершится.
  let stop: (() => Promise<void>) | null = null;
  let stopRequested = false;
  const stopAndExit = () => {
    if (!stop) {
      stopRequested = true;
      return;
    }
    stop().then(
      () => exit(0),
      (e) => {
        console.error(e);
        exit(1);
      },
    );
  };
  if (opts.handleSignals ?? true) {
    const proc = opts.proc ?? process;
    for (const sig of ['SIGINT', 'SIGTERM', 'SIGHUP', 'SIGBREAK'] as const) proc.on(sig, stopAndExit);
    // Остановка по просьбе супервизора через IPC (в Windows SIGTERM = жёсткое убийство процесса).
    proc.on('message', (m: unknown) => {
      if ((m as { type?: string } | null)?.type === 'shutdown') stopAndExit();
    });
    // Супервизор исчез — не оставляем сервер-сироту.
    proc.on('disconnect', stopAndExit);
    // Канал закрылся ещё до регистрации слушателя — 'disconnect' уже не придёт.
    if (proc.send && !proc.connected) stopAndExit();
  }

  const dbExisted = fs.existsSync(config.dbPath);
  let sqlite: Sqlite | undefined;
  let app: FastifyInstance | undefined;
  let scheduler: { stop(): void } | undefined;
  let url: string;
  try {
    const opened = openDb(config.dbPath);
    sqlite = opened.sqlite;
    const { db } = opened;
    // Один сервис бэкапов на процесс: его статус (lastCopyError) видит /backup/status.
    // До создания приложения сообщения идут в консоль, после — в журнал приложения (pino).
    let backupLog = (m: string, e?: unknown) => (e ? console.error(m, e) : console.log(m));
    const backup = createBackupService({ sqlite, config, log: (m, e) => backupLog(m, e) });

    migrateWithBackup({ db, sqlite, dbExisted, backup });
    await seedCurrencies(db);

    const built = await buildApp({ config, db, sqlite, backup, logger: opts.logger ?? createLoggerOptions(config) });
    app = built;
    backupLog = (m, e) => (e ? built.log.error({ err: e }, m) : built.log.info(m));
    try {
      backup.ensureRecent();
    } catch (e) {
      // Без свежего бэкапа приложение всё равно должно работать; ошибка видна в журнале.
      built.log.error({ err: e }, 'Не удалось сделать стартовый бэкап');
    }

    await built.listen({ host: config.host, port: config.port });
    scheduler = startScheduler({
      timezone: config.timezone,
      log: (m, e) => built.log.error({ err: e }, m),
      // в очереди соединения: VACUUM INTO внутри открытой транзакции невозможен
      jobs: [{ name: 'daily-backup', cron: '0 4 * * *', run: async () => void (await inLine(db, () => backup.create('daily'))) }],
    });
    const addr = built.server.address();
    const port = typeof addr === 'object' && addr ? addr.port : config.port;
    const wildcard = isWildcardHost(config.host);
    url = `http://${wildcard ? '127.0.0.1' : config.host}:${port}`;
    if (wildcard) {
      built.log.warn(`HOST=${config.host}: приложение доступно в локальной сети по HTTP без шифрования`);
    }
  } catch (e) {
    scheduler?.stop();
    try {
      await app?.close();
    } catch {
      /* исходная ошибка важнее */
    }
    try {
      sqlite?.close();
    } catch {
      /* исходная ошибка важнее */
    }
    releaseLock();
    throw e;
  }
  const runningApp = app;
  const runningSqlite = sqlite;
  const runningScheduler = scheduler;

  const doStop = async () => {
    runningScheduler.stop();
    // Принудительный выход, если очистка зависла; таймер остаётся взведённым до её конца.
    const timer = setTimeout(() => exit(1), 10_000);
    timer.unref();
    try {
      try {
        await runningApp.close();
      } finally {
        try {
          runningSqlite.close();
        } finally {
          releaseLock();
        }
      }
    } finally {
      clearTimeout(timer);
    }
  };
  let stopPromise: Promise<void> | null = null;
  const stopOnce = () => (stopPromise ??= doStop());
  stop = stopOnce;
  if (stopRequested) stopAndExit();
  return { app: runningApp, url, stop: stopOnce };
}
