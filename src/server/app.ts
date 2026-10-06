import fs from 'node:fs';
import path from 'node:path';
import cookie from '@fastify/cookie';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import fastifyStatic from '@fastify/static';
import Fastify, { type FastifyInstance, type FastifyServerOptions } from 'fastify';
import type { Config } from './config';
import type { Db, Sqlite } from './db/client';
import { registerErrorHandler } from './errors';
import { registerAccountsRoutes } from './modules/accounts/routes';
import { registerCategoriesRoutes } from './modules/categories/routes';
import { registerProjectsRoutes } from './modules/projects/routes';
import { createProjectsService } from './modules/projects/service';
import { registerTemplatesRoutes } from './modules/templates/routes';
import { createAccountsService } from './modules/accounts/service';
import { createAuditService } from './modules/audit/service';
import { registerBackupRoutes } from './modules/backup/routes';
import { createBackupService, type BackupService } from './modules/backup/service';
import { LoginLimiter } from './modules/auth/login-limiter';
import { readSessionToken, registerAuth } from './modules/auth/plugin';
import { registerAuthRoutes } from './modules/auth/routes';
import { createSessionsService } from './modules/auth/sessions';
import { createCategoriesService } from './modules/categories/service';
import { registerCompaniesRoutes } from './modules/companies/routes';
import { createCompaniesService } from './modules/companies/service';
import { createUsersService } from './modules/users/service';
import { resolveClientIp } from './security/client-ip';
import { registerCsrf } from './security/csrf';

export interface AppDeps {
  config: Config;
  db: Db;
  sqlite: Sqlite;
  logger?: FastifyServerOptions['logger'];
  now?: () => Date;
  clientDir?: string;
  extraRoutes?: (app: FastifyInstance) => void;
  /** Общий сервис бэкапов процесса (startServer); без него приложение создаёт свой (тесты). */
  backup?: BackupService;
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
  const categories = createCategoriesService(db, now);
  const accounts = createAccountsService(db, now);
  const companies = createCompaniesService({ db, audit, categories, accounts, now });
  registerCompaniesRoutes(app, { companies });
  const projects = createProjectsService({ db, audit, companies, categories, accounts, timezone: config.timezone, now });
  registerTemplatesRoutes(app);
  registerProjectsRoutes(app, { projects });
  registerCategoriesRoutes(app, { categories, companies });
  registerAccountsRoutes(app, { accounts, companies });
  const backup =
    deps.backup ??
    createBackupService({
      sqlite: deps.sqlite,
      config,
      now,
      log: (m, e) => (e ? app.log.error({ err: e }, m) : app.log.info(m)),
    });
  registerBackupRoutes(app, { backup });

  const clientDir = deps.clientDir ?? path.resolve('dist', 'client');
  if (fs.existsSync(path.join(clientDir, 'index.html'))) {
    await app.register(fastifyStatic, { root: clientDir, prefix: '/', wildcard: false });
    app.setNotFoundHandler((req, reply) => {
      if (req.url.startsWith('/api/') || req.method !== 'GET') {
        return reply.status(404).send({ error: { code: 'NOT_FOUND', message: 'Не найдено' } });
      }
      return reply.type('text/html').sendFile('index.html');
    });
  } else {
    app.setNotFoundHandler((req, reply) =>
      reply.status(404).send({ error: { code: 'NOT_FOUND', message: 'Не найдено' } }),
    );
  }

  deps.extraRoutes?.(app);
  return app;
}
