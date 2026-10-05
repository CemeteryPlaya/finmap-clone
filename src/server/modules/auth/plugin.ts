import type { FastifyInstance } from 'fastify';
import { AppError } from '../../errors';
import type { AuthUser } from '../users/service';
import type { SessionsService } from './sessions';

declare module 'fastify' {
  interface FastifyRequest {
    user: AuthUser | null;
    sessionId: number | null;
  }
}

const PUBLIC_ROUTES = new Set(['/api/v1/health', '/api/v1/meta', '/api/v1/auth/login']);

export function readSessionToken(req: import('fastify').FastifyRequest): string | null {
  const raw = req.cookies.sid;
  if (!raw) return null;
  const un = req.unsignCookie(raw);
  return un.valid && un.value ? un.value : null;
}

export function registerAuth(app: FastifyInstance, deps: { sessions: SessionsService }): void {
  app.decorateRequest('user', null);
  app.decorateRequest('sessionId', null);

  app.addHook('preHandler', async (req) => {
    if (!req.url.startsWith('/api/')) return;
    const token = readSessionToken(req);
    if (token) {
      const s = deps.sessions.touch(token);
      if (s) {
        req.user = s.user;
        req.sessionId = s.id;
      }
    }
    const route = req.routeOptions.url;
    if (!route) return; // неизвестный путь — отдаст 404 обработчик not-found
    if (PUBLIC_ROUTES.has(route)) return;
    // тестовые маршруты из createTestApp(…, extraRoutes); VITEST выставляет сам Vitest, в рабочем процессе её нет
    if (process.env.VITEST && route.startsWith('/api/v1/__test/')) return;
    if (!req.user) throw new AppError(401, 'UNAUTHORIZED', 'Требуется вход');
  });
}
