import { build } from 'esbuild';

/**
 * Пакеты вне бандла: бинарные модули (собираются под Linux при установке на Vercel), WASM PGlite (только тесты),
 * транспорты журнала (только локально) и необязательные ускорители ws.
 */
export const SERVER_EXTERNAL = ['better-sqlite3', '@node-rs/argon2', '@electric-sql/pglite', 'pino-pretty', 'pino-roll', 'bufferutil', 'utf-8-validate'];

/**
 * В начале server.mjs: require, __filename и __dirname для CommonJS-кода внутри ESM-бандла. Строка с import "fastify" —
 * в комментарии: по ней Vercel (@vercel/fastify) узнаёт приложение Fastify, хотя сам fastify теперь внутри бандла.
 */
const BANNER = [
  '// Функция Vercel — приложение Fastify: import "fastify" (план 2026-10-20-vercel-postgres; собрано scripts/build-server.ts)',
  "import { createRequire as __fcCreateRequire } from 'node:module';",
  "import { fileURLToPath as __fcFileURLToPath } from 'node:url';",
  "import { dirname as __fcDirname } from 'node:path';",
  'const require = __fcCreateRequire(import.meta.url);',
  'const __filename = __fcFileURLToPath(import.meta.url);',
  'const __dirname = __fcDirname(__filename);',
].join('\n');

/**
 * Функция Vercel (план 2026-10-20-vercel-postgres, задача 13): src/server/vercel-entry.ts, код приложения и все JS-пакеты —
 * в один ESM-файл. Загрузчик функций Vercel не умеет require() ES-модулей (Node 24 умеет), а CommonJS-пакеты подключают
 * ESM-only зависимости (@fastify/static → content-disposition, light-my-request и @fastify/cookie → cookie) — внутри
 * бандла esbuild сводит их сам. Свой бандл заодно снимает относительные импорты без расширения и проверку типов при сборке.
 * Возвращает внешние импорты бандла (metafile esbuild) — что функция берёт из node_modules.
 */
export async function buildServer(outfile: string): Promise<{ externals: string[] }> {
  const result = await build({
    entryPoints: ['src/server/vercel-entry.ts'],
    outfile,
    bundle: true,
    external: SERVER_EXTERNAL,
    platform: 'node',
    format: 'esm',
    target: 'node24',
    banner: { js: BANNER },
    logLevel: 'warning',
    metafile: true,
  });
  const imports = Object.values(result.metafile.outputs).flatMap((o) => o.imports.filter((i) => i.external).map((i) => i.path));
  return { externals: [...new Set(imports)].sort() };
}
