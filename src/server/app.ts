import cookie from '@fastify/cookie';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import Fastify, { type FastifyInstance, type FastifyServerOptions } from 'fastify';
import type { Config } from './config';
import type { Db, Sqlite } from './db/client';
import { registerErrorHandler } from './errors';
import { createAuditService } from './modules/audit/service';
import { LoginLimiter } from './modules/auth/login-limiter';
import { readSessionToken, registerAuth } from './modules/auth/plugin';
import { registerAuthRoutes } from './modules/auth/routes';
import { createSessionsService } from './modules/auth/sessions';
import { createUsersService } from './modules/users/service';
import { resolveClientIp } from './security/client-ip';
import { registerCsrf } from './security/csrf';

export interface AppDeps {
  config: Config;
  db: Db;
  sqlite: Sqlite;
  logger?: FastifyServerOptions['logger'];
  now?: () => Date;
  extraRoutes?: (app: FastifyInstance) => void;
}

export async function buildApp(deps: AppDeps): Promise<FastifyInstance> {
  const { config, db } = deps;
  const now = deps.now ?? (() => new Date());
  const app = Fastify({ logger: deps.logger ?? false, trustProxy: 'loopback', bodyLimit: 1024 * 1024 });

  registerErrorHandler(app);
  await app.register(cookie, { secret: config.sessionSecret });
  await app.register(helmet, {
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'"],
        styleSrc: ["'self'", "'unsafe-inline'"],
        imgSrc: ["'self'", 'data:', 'blob:'],
        connectSrc: ["'self'"],
        fontSrc: ["'self'", 'data:'],
        objectSrc: ["'none'"],
        frameAncestors: ["'none'"],
        upgradeInsecureRequests: null,
      },
    },
  });
  await app.register(rateLimit, {
    global: true,
    max: 300,
    timeWindow: '1 minute',
    keyGenerator: (req) => {
      const token = readSessionToken(req);
      return token ? `s:${token}` : `ip:${resolveClientIp(req, config.deployMode)}`;
    },
  });
  registerCsrf(app, config.allowedOrigins);

  const audit = createAuditService(db, now);
  const users = createUsersService(db, audit, now);
  const sessions = createSessionsService(db, users, now);
  const limiter = new LoginLimiter();

  registerAuth(app, { sessions });

  app.get('/api/v1/health', async () => ({ ok: true }));
  app.get('/api/v1/meta', async () => ({ appName: config.appName }));
  registerAuthRoutes(app, { users, sessions, limiter, audit, config });

  deps.extraRoutes?.(app);
  return app;
}
