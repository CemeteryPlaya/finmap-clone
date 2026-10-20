import type { IncomingMessage, ServerResponse } from 'node:http';
import type { FastifyInstance } from 'fastify';
import { createServerlessApp, startupErrorApp } from './serverless';

/**
 * Точка входа на Vercel (план 2026-10-20-vercel-postgres, задача 13): сборка (scripts/build-server.ts) собирает её в
 * server.mjs в корне проекта. Vercel вызывает обработчик по умолчанию (req, res) — как обычную Node-функцию; listen() не
 * нужен: перехват listen у Vercel срабатывает на пакет fastify из node_modules, а он внутри бандла. Приложение одно на
 * экземпляр; не запустилось — причина в журнале и в ответе 503 (startupErrorApp). Локальный запуск — src/server/index.ts.
 */
let app: Promise<FastifyInstance> | null = null;

function appOnce(): Promise<FastifyInstance> {
  app ??= createServerlessApp(process.env).catch(async (e: unknown) => {
    console.error('Приложение не запустилось:', e);
    const fallback = startupErrorApp(e);
    await fallback.ready();
    return fallback;
  });
  return app;
}

// запуск — сразу при загрузке модуля: первый запрос не ждёт сборки приложения с нуля
void appOnce();

export default async function handler(req: IncomingMessage, res: ServerResponse): Promise<void> {
  (await appOnce()).server.emit('request', req, res);
}
