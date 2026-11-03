import type { IncomingMessage, ServerResponse } from 'node:http';
import Fastify, { type FastifyInstance } from 'fastify';
import { buildApp } from './app';
import { type DbConfig, loadConfig } from './config';
import { openDatabase, type OpenedDatabase } from './db/client';
import { createLoggerOptions } from './logger';

/**
 * Приложение для функции Vercel (план 2026-10-20-vercel-postgres, задача 13): база открывается один раз на экземпляр
 * (кэш модуля), без миграций (они идут на сборке, scripts/migrate.ts), блокировки, сигналов и планировщика — ежедневное
 * задание вызывает Vercel Cron. `opts.db` — другая база вместо DATABASE_URL, `opts.clientDir` — другая сборка интерфейса (тесты).
 */
let instance: Promise<{ app: FastifyInstance; opened: OpenedDatabase }> | null = null;

export async function createServerlessApp(env: Record<string, string | undefined>, opts: { db?: DbConfig; clientDir?: string } = {}): Promise<FastifyInstance> {
  instance ??= (async () => {
    const config = loadConfig({ ...env, DEPLOY_MODE: 'vercel' });
    const opened = await openDatabase(opts.db ?? config.db);
    try {
      const app = await buildApp({ config, db: opened.db, sqlite: null, logger: createLoggerOptions(config), clientDir: opts.clientDir });
      await app.ready();
      return { app, opened };
    } catch (e) {
      await opened.close();
      throw e;
    }
  })().catch((e: unknown) => {
    instance = null; // следующий запрос попробует снова
    throw e;
  });
  return (await instance).app;
}

/** Закрыть приложение и базу экземпляра (тесты). */
export async function disposeServerlessApp(): Promise<void> {
  const current = instance;
  instance = null;
  if (!current) return;
  const { app, opened } = await current.catch(() => ({ app: null, opened: null }));
  await app?.close();
  await opened?.close();
}

/**
 * Обработчик функции Vercel (req, res). Приложение одно на экземпляр, запуск — сразу при создании: первый запрос не ждёт
 * сборки с нуля. Сбой запуска не запоминается: запрос пробует ещё раз, а не удалось и так — 503 (startupErrorApp) только
 * этому запросу, следующий запускает заново. Раньше один ложный таймаут холодного старта отдавал 503 на все запросы экземпляра.
 */
export function createHandler(start: () => Promise<FastifyInstance>): (req: IncomingMessage, res: ServerResponse) => Promise<void> {
  let app: Promise<FastifyInstance> | null = null;
  const once = () =>
    (app ??= start().catch((e: unknown) => {
      console.error('Приложение не запустилось:', e);
      app = null;
      throw e;
    }));
  void once().catch(() => undefined);

  async function resolve(): Promise<FastifyInstance> {
    try {
      return await once();
    } catch {
      // причина — в журнале; ещё одна попытка
    }
    try {
      return await once();
    } catch (e) {
      const fallback = startupErrorApp(e);
      await fallback.ready();
      return fallback;
    }
  }

  return async (req, res) => {
    (await resolve()).server.emit('request', req, res);
  };
}

/**
 * Приложение не запустилось (чаще всего — не хватает переменной окружения): вместо падения функции, которое Vercel
 * показывает безликим FUNCTION_INVOCATION_FAILED, на любой адрес — 503 с причиной. Текст ошибки конфигурации называет
 * только переменную, без значений; прочие ошибки (в них бывают адреса и пароли) — только в журнале Vercel.
 */
export function startupErrorApp(e: unknown): FastifyInstance {
  const text = e instanceof Error ? e.message : String(e);
  const message = text.startsWith('Ошибка конфигурации') ? text : 'Сервер не запустился — причина в журнале Vercel (Logs)';
  const app = Fastify({ logger: false });
  app.all('/*', async (_req, reply) => reply.status(503).header('Cache-Control', 'no-store').send({ error: { code: 'STARTUP_FAILED', message } }));
  return app;
}
