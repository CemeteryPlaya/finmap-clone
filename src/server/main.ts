import fs from 'node:fs';
import type { FastifyInstance, FastifyServerOptions } from 'fastify';
import { buildApp } from './app';
import type { Config } from './config';
import { openDb } from './db/client';
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
  const { sqlite, db } = openDb(config.dbPath);
  const log = (m: string, e?: unknown) => (e ? console.error(m, e) : console.log(m));
  const backup = createBackupService({ sqlite, config, log });

  const applied = appliedMigrationsCount(sqlite);
  if (dbExisted && applied > 0 && applied < codeMigrationsCount()) backup.create('pre-migration');
  runMigrations(db);
  seedCurrencies(db);
  backup.ensureRecent();

  const app = await buildApp({ config, db, sqlite, logger: opts.logger ?? createLoggerOptions(config) });
  const scheduler = startScheduler({
    timezone: config.timezone,
    log: (m, e) => app.log.error({ err: e }, m),
    jobs: [{ name: 'daily-backup', cron: '0 4 * * *', run: () => void backup.create('daily') }],
  });

  await app.listen({ host: config.host, port: config.port });
  const addr = app.server.address();
  const port = typeof addr === 'object' && addr ? addr.port : config.port;
  const url = `http://${config.host === '0.0.0.0' ? '127.0.0.1' : config.host}:${port}`;
  if (config.host === '0.0.0.0') {
    app.log.warn('HOST=0.0.0.0: приложение доступно в локальной сети по HTTP без шифрования');
  }

  let stopping = false;
  const stop = async () => {
    if (stopping) return;
    stopping = true;
    scheduler.stop();
    const timer = setTimeout(() => process.exit(1), 10_000);
    timer.unref();
    await app.close();
    sqlite.close();
    releaseLock();
    clearTimeout(timer);
  };

  if (opts.handleSignals ?? true) {
    for (const sig of ['SIGINT', 'SIGTERM', 'SIGHUP', 'SIGBREAK'] as const) {
      process.on(sig, () => {
        void stop().then(() => process.exit(0));
      });
    }
  }
  return { app, url, stop };
}
