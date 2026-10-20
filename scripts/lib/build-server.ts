import { build } from 'esbuild';

/**
 * Функция Vercel (план 2026-10-20-vercel-postgres, задача 13): src/server/vercel-entry.ts и весь код приложения — в один
 * ESM-файл. Пакеты остаются импортами: Vercel сам собирает node_modules функции, включая бинарные модули под Linux
 * (better-sqlite3, @node-rs/argon2). Свой бандл снимает две проблемы сборщика Vercel: относительные импорты без
 * расширения (ESM в Node их не находит) и проверку типов TypeScript при сборке.
 */
export async function buildServer(outfile: string): Promise<void> {
  await build({
    entryPoints: ['src/server/vercel-entry.ts'],
    outfile,
    bundle: true,
    packages: 'external',
    platform: 'node',
    format: 'esm',
    target: 'node24',
    logLevel: 'warning',
  });
}
