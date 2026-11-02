import crypto from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { AppError } from '../../errors';
import type { SenetSync } from '../senet/sync';
import { type DailyDeps, runDaily } from './daily';

/** Бюджет забора Senet в функции Vercel (300 с), с запасом на ответ и запись журнала. */
const SENET_BUDGET_MS = 240_000;

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
export function registerCronRoutes(app: FastifyInstance, deps: DailyDeps & { secret: string; senetSync?: SenetSync }): void {
  app.get('/api/v1/cron/daily', async (req) => {
    if (!sameSecret(req.headers.authorization ?? '', `Bearer ${deps.secret}`)) throw new AppError(401, 'UNAUTHORIZED', 'Неверный ключ задания');
    const started = performance.now();
    const report = await runDaily(deps);
    req.log.info({ ...report, ms: Math.round(performance.now() - started) }, 'Ежедневное задание выполнено');
    return report;
  });

  /**
   * GET /api/v1/cron/senet — забор Senet (спецификация 2026-11-02-senet-autopost, §7): раз в сутки Vercel Cron, каждый час —
   * пингер GitHub Actions с тем же секретом. Бюджет — 240 с из 300 с функции; что не успели — следующий запуск.
   */
  const senetSync = deps.senetSync;
  if (!senetSync) return;
  app.get('/api/v1/cron/senet', async (req) => {
    if (!sameSecret(req.headers.authorization ?? '', `Bearer ${deps.secret}`)) throw new AppError(401, 'UNAUTHORIZED', 'Неверный ключ задания');
    if (await senetSync.running()) throw new AppError(409, 'SENET_SYNC_RUNNING', 'Забор Senet уже идёт');
    const runs = await senetSync.run({ trigger: 'cron', deadline: Date.now() + SENET_BUDGET_MS });
    req.log.info({ runs: runs.map((r) => ({ connectionId: r.connectionId, result: r.result })) }, 'Забор Senet выполнен');
    return { runs };
  });
}
