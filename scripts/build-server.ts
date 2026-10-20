import { buildServer } from './lib/build-server';

// npm run vercel-build, последний шаг: server.mjs в корне проекта — точка входа Fastify для Vercel (scripts/lib/build-server.ts).
await buildServer('server.mjs');
console.log('Функция собрана: server.mjs');
