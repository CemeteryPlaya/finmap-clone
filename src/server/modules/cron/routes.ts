import crypto from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { AppError } from '../../errors';
import { type DailyDeps, runDaily } from './daily';

/** Сравнение без утечки по времени: заголовок другой длины — сразу отказ. */
function sameSecret(given: string, expected: string): boolean {
  const a = Buffer.from(given);
  const b = Buffer.from(expected);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

/**
 * GET /api/v1/cron/daily — Vercel Cron (vercel.json, 23:00 UTC = 04:00 по Алматы). Без сессии: Vercel присылает
 * Authorization: Bearer CRON_SECRET; иначе — 401 (Р13).
 */
export function registerCronRoutes(app: FastifyInstance, deps: DailyDeps & { secret: string }): void {
  app.get('/api/v1/cron/daily', async (req) => {
    if (!sameSecret(req.headers.authorization ?? '', `Bearer ${deps.secret}`)) throw new AppError(401, 'UNAUTHORIZED', 'Неверный ключ задания');
    const started = performance.now();
    const report = await runDaily(deps);
    req.log.info({ ...report, ms: Math.round(performance.now() - started) }, 'Ежедневное задание выполнено');
    return report;
  });
}
