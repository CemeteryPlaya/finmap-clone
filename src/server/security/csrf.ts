import type { FastifyInstance } from 'fastify';
import { AppError } from '../errors';

const SAFE = new Set(['GET', 'HEAD', 'OPTIONS']);

export function registerCsrf(app: FastifyInstance, allowedOrigins: string[]): void {
  const allowed = new Set(allowedOrigins);
  app.addHook('onRequest', async (req) => {
    // Решаем по сопоставленному маршруту (декодированному), а не по сырому req.url.
    const route = req.routeOptions.url;
    if (SAFE.has(req.method) || !route || !route.startsWith('/api/')) return;
    if (req.headers['x-requested-with'] !== 'fetch') {
      throw new AppError(403, 'CSRF', 'Запрос отклонён защитой от подделки');
    }
    const origin = req.headers.origin;
    if (typeof origin !== 'string' || !allowed.has(origin)) {
      throw new AppError(403, 'CSRF', 'Запрос отклонён защитой от подделки');
    }
  });
}
