import type { FastifyInstance } from 'fastify';
import { createServerlessApp, startupErrorApp } from './serverless';

/**
 * Точка входа на Vercel (план 2026-10-20-vercel-postgres, задача 13): сборка (scripts/build-server.ts) собирает её в server.mjs в корне проекта;
 * Vercel находит его как точку входа Fastify и перехватывает listen — приложение становится одной функцией. Локальный
 * запуск — src/server/index.ts (npm start). Не запустилось — причина в журнале и в ответе 503 (startupErrorApp).
 */
let app: FastifyInstance;
try {
  app = await createServerlessApp(process.env);
} catch (e) {
  console.error('Приложение не запустилось:', e);
  app = startupErrorApp(e);
}
await app.listen({ host: '0.0.0.0', port: Number(process.env.PORT ?? 3000) });
