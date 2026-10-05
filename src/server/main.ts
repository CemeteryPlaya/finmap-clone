import fs from 'node:fs';
import type { FastifyInstance, FastifyServerOptions } from 'fastify';
import { buildApp } from './app';
import type { Config } from './config';
import { openDb, type Sqlite } from './db/client';
import { appliedMigrationsCount, codeMigrationsCount, runMigrations } from './db/migrate';
import { seedCurrencies } from './db/seed';
import { startScheduler } from './jobs/scheduler';
import { acquireLock } from './lock';
import { createLoggerOptions } from './logger';
import { createBackupService } from './modules/backup/service';

export const EXIT_LOCK_HELD = 3;

export interface RunningServer {
  app: FastifyInstance;
  url: string;
  stop(): Promise<void>;
}

export async function startServer(
  config: Config,
  opts: { logger?: FastifyServerOptions['logger']; handleSignals?: boolean } = {},
): Promise<RunningServer> {
  for (const d of [config.dataDir, config.uploadsDir, config.backupsDir, config.logsDir]) fs.mkdirSync(d, { recursive: true });
  const releaseLock = acquireLock(config.lockPath);

  const dbExisted = fs.existsSync(config.dbPath);
  let sqlite: Sqlite | undefined;
  let app: FastifyInstance | undefined;
  let scheduler: { stop(): void } | undefined;
  let url: string;
  try {
    const opened = openDb(config.dbPath);
    sqlite = opened.sqlite;
    const { db } = opened;
    const log = (m: string, e?: unknown) => (e ? console.error(m, e) : console.log(m));
    const backup = createBackupService({ sqlite, config, log });

    const applied = appliedMigrationsCount(sqlite);
    if (dbExisted && applied > 0 && applied < codeMigrationsCount()) backup.create('pre-migration');
    runMigrations(db);
    seedCurrencies(db);
    backup.ensureRecent();

    const built = await buildApp({ config, db, sqlite, logger: opts.logger ?? createLoggerOptions(config) });
    app = built;
    await built.listen({ host: config.host, port: config.port });
    scheduler = startScheduler({
      timezone: config.timezone,
      log: (m, e) => built.log.error({ err: e }, m),
      jobs: [{ name: 'daily-backup', cron: '0 4 * * *', run: () => void backup.create('daily') }],
    });
    const addr = built.server.address();
    const port = typeof addr === 'object' && addr ? addr.port : config.port;
    url = `http://${config.host === '0.0.0.0' ? '127.0.0.1' : config.host}:${port}`;
    if (config.host === '0.0.0.0') {
      built.log.warn('HOST=0.0.0.0: приложение доступно в локальной сети по HTTP без шифрования');
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
    const timer = setTimeout(() => process.exit(1), 10_000);
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
  const stop = () => (stopPromise ??= doStop());

  if (opts.handleSignals ?? true) {
    for (const sig of ['SIGINT', 'SIGTERM', 'SIGHUP', 'SIGBREAK'] as const) {
      process.on(sig, () => {
        stop().then(
          () => process.exit(0),
          (e) => {
            console.error(e);
            process.exit(1);
          },
        );
      });
    }
  }
  return { app: runningApp, url, stop };
}
