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

// ежедневное задание Vercel входит не сессией, а ключом CRON_SECRET (проверяет сам маршрут)
const PUBLIC_ROUTES = new Set(['/api/v1/health', '/api/v1/meta', '/api/v1/auth/login', '/api/v1/cron/daily']);

export function readSessionToken(req: import('fastify').FastifyRequest): string | null {
  const raw = req.cookies.sid;
  if (!raw) return null;
  const un = req.unsignCookie(raw);
  return un.valid && un.value ? un.value : null;
}

export function registerAuth(app: FastifyInstance, deps: { sessions: SessionsService }): void {
  app.decorateRequest('user', null);
  app.decorateRequest('sessionId', null);

  app.addHook('preHandler', async (req, reply) => {
    // решаем по сопоставленному маршруту, а не по сырому req.url (иначе /%61pi/... обходит проверку)
    const route = req.routeOptions.url;
    if (!route || !route.startsWith('/api/')) return; // неизвестный путь — отдаст 404 обработчик not-found
    const token = readSessionToken(req);
    if (token) {
      const s = await deps.sessions.touch(token);
      if (s) {
        req.user = s.user;
        req.sessionId = s.id;
        if (s.renewed?.remember) {
          reply.setCookie('sid', token, {
            path: '/',
            httpOnly: true,
            sameSite: 'lax',
            secure: req.protocol === 'https',
            signed: true,
            expires: s.renewed.expiresAt,
          });
        }
      }
    }
    if (PUBLIC_ROUTES.has(route)) return;
    // тестовые маршруты из createTestApp(…, extraRoutes); VITEST выставляет сам Vitest, в рабочем процессе её нет
    if (process.env.VITEST && route.startsWith('/api/v1/__test/')) return;
    if (!req.user) throw new AppError(401, 'UNAUTHORIZED', 'Требуется вход');
  });
}
