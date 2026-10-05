import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { Config } from '../../config';
import { AppError } from '../../errors';
import { resolveClientIp } from '../../security/client-ip';
import type { AuditService } from '../audit/service';
import { normalizeLogin, type UsersService } from '../users/service';
import type { LoginLimiter } from './login-limiter';
import { readSessionToken } from './plugin';
import type { SessionsService } from './sessions';

const loginBody = z.object({
  login: z.string().min(1, 'Введите логин').max(64),
  password: z.string().min(1, 'Введите пароль').max(256),
  remember: z.boolean().optional().default(false),
});

export function registerAuthRoutes(
  app: FastifyInstance,
  deps: { users: UsersService; sessions: SessionsService; limiter: LoginLimiter; audit: AuditService; config: Config },
): void {
  app.post('/api/v1/auth/login', async (req, reply) => {
    const body = loginBody.parse(req.body);
    const ip = resolveClientIp(req, deps.config.deployMode);
    const keys = [`login:${normalizeLogin(body.login)}`, `ip:${ip}`];
    if (deps.limiter.isBlocked(keys)) {
      throw new AppError(429, 'RATE_LIMITED', 'Слишком много попыток входа. Повторите через 15 минут');
    }
    const user = await deps.users.verifyCredentials(body.login, body.password);
    if (!user) {
      deps.limiter.recordFailure(keys);
      throw new AppError(401, 'INVALID_CREDENTIALS', 'Неверный логин или пароль');
    }
    deps.limiter.reset([keys[0]!]); // счётчик IP не сбрасываем: иначе его можно обнулять входом в любой учётной записи
    const s = deps.sessions.create({
      userId: user.id,
      remember: body.remember,
      ip,
      userAgent: req.headers['user-agent'] ?? null,
    });
    reply.setCookie('sid', s.token, {
      path: '/',
      httpOnly: true,
      sameSite: 'lax',
      secure: req.protocol === 'https',
      signed: true,
      ...(body.remember ? { expires: s.expiresAt } : {}),
    });
    deps.audit.record({ userId: user.id, entity: 'user', entityId: user.id, action: 'login', diff: { ip } });
    return { user };
  });

  app.post('/api/v1/auth/logout', async (req, reply) => {
    const token = readSessionToken(req);
    if (token) deps.sessions.revoke(token);
    reply.clearCookie('sid', { path: '/' });
    deps.audit.record({ userId: req.user!.id, entity: 'user', entityId: req.user!.id, action: 'logout' });
    return reply.status(204).send();
  });

  app.get('/api/v1/auth/me', async (req) => ({ user: req.user }));
}
