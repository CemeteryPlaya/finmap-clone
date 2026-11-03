import { createHandler, createServerlessApp } from './serverless';

/**
 * Точка входа на Vercel (план 2026-10-20-vercel-postgres, задача 13): сборка (scripts/build-server.ts) собирает её в
 * server.mjs в корне проекта. Vercel вызывает обработчик по умолчанию (req, res) — как обычную Node-функцию; listen() не
 * нужен: перехват listen у Vercel срабатывает на пакет fastify из node_modules, а он внутри бандла. Приложение одно на
 * экземпляр; сбой запуска — повтор, затем 503 с причиной в журнале (createHandler). Локальный запуск — src/server/index.ts.
 */
export default createHandler(() => createServerlessApp(process.env));
