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
import { registerCounterpartiesRoutes } from './modules/counterparties/routes';
import { createCounterpartiesService } from './modules/counterparties/service';
import { registerTagsRoutes } from './modules/tags/routes';
import { createTagsService } from './modules/tags/service';
import { registerProjectsRoutes } from './modules/projects/routes';
import { createProjectsService } from './modules/projects/service';
import { registerTemplatesRoutes } from './modules/templates/routes';
import { createAccountsService } from './modules/accounts/service';
import { registerAuditRoutes } from './modules/audit/routes';
import { createAuditService } from './modules/audit/service';
import { registerBackupRoutes } from './modules/backup/routes';
import { createBackupService, type BackupService } from './modules/backup/service';
import { LoginLimiter } from './modules/auth/login-limiter';
import { readSessionToken, registerAuth } from './modules/auth/plugin';
import { registerAuthRoutes } from './modules/auth/routes';
import { createSessionsService } from './modules/auth/sessions';
import { createLedgerBalances } from './modules/balances/service';
import { createOperationsReferences } from './modules/references/service';
import { createCategoriesService } from './modules/categories/service';
import { registerBalancesRoutes } from './modules/balances/routes';
import { registerAttachmentsRoutes } from './modules/attachments/routes';
import { registerImportsRoutes } from './modules/imports/routes';
import { createImportsService } from './modules/imports/service';
import { createAttachmentsService } from './modules/attachments/service';
import { createBulkService } from './modules/operations/bulk';
import { createJournal } from './modules/operations/journal';
import { registerOperationsRoutes } from './modules/operations/routes';
import { registerRatesRoutes } from './modules/rates/routes';
import { createOperationsService } from './modules/operations/service';
import { createOperationsWriter } from './modules/operations/writer';
import { createRatesService } from './modules/rates/service';
import { registerSavedFiltersRoutes } from './modules/saved-filters/routes';
import { createSavedFiltersService } from './modules/saved-filters/service';
import { registerSplitPresetsRoutes } from './modules/split-presets/routes';
import { createStockBalanceService } from './modules/stock/balance';
import { createStockCatalogService } from './modules/stock/catalog';
import { createStockDocsService } from './modules/stock/docs';
import { createStockPostingsService } from './modules/stock/postings';
import { registerStockRoutes } from './modules/stock/routes';
import { createStockWarehousesService } from './modules/stock/warehouses';
import { createSplitPresetsService } from './modules/split-presets/service';
import { registerCompaniesRoutes } from './modules/companies/routes';
import { createCompaniesService } from './modules/companies/service';
import { registerUsersRoutes } from './modules/users/routes';
import { createUsersService } from './modules/users/service';
import { registerPreferencesRoutes } from './modules/preferences/routes';
import { registerPwaRoutes } from './pwa/routes';
import { createPreferencesService } from './modules/preferences/service';
import { resolveClientIp } from './security/client-ip';
import { registerCsrf } from './security/csrf';
import { installZodRu } from '../shared/zod-ru';

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
  installZodRu();
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
  app.get('/api/v1/meta', async () => ({ appName: config.appName, timezone: config.timezone }));
  registerPwaRoutes(app, { appName: config.appName });
  registerAuthRoutes(app, { users, sessions, limiter, audit, config });
  registerUsersRoutes(app, { users });
  registerPreferencesRoutes(app, { preferences: createPreferencesService(db, now) });
  const references = createOperationsReferences(db, config.timezone);
  const balances = createLedgerBalances(db);
  const categories = createCategoriesService({ db, audit, references, now });
  const accounts = createAccountsService({ db, audit, references, balances, timezone: config.timezone, now });
  const companies = createCompaniesService({ db, audit, categories, accounts, now });
  registerCompaniesRoutes(app, { companies });
  registerAuditRoutes(app, { audit, companies });
  const projects = createProjectsService({ db, audit, companies, categories, accounts, references, timezone: config.timezone, now });
  registerTemplatesRoutes(app);
  registerProjectsRoutes(app, { projects });
  registerCategoriesRoutes(app, { categories, companies });
  registerAccountsRoutes(app, { accounts, companies, references });
  const counterparties = createCounterpartiesService({ db, audit, references, now });
  registerCounterpartiesRoutes(app, { counterparties });
  const tags = createTagsService({ db, audit, references, now });
  registerTagsRoutes(app, { tags });
  registerSplitPresetsRoutes(app, { splitPresets: createSplitPresetsService({ db, audit, now }) });
  const rates = createRatesService({ db, audit, now });
  registerRatesRoutes(app, { db, rates });
  const operations = createOperationsService({ db, audit, rates, timezone: config.timezone, now });
  registerOperationsRoutes(app, {
    operations,
    journal: createJournal({ db, balances, timezone: config.timezone, now }),
    bulk: createBulkService({ db, operations }),
  });
  registerStockRoutes(app, {
    db,
    catalog: createStockCatalogService({ db, audit, timezone: config.timezone, now }),
    warehouses: createStockWarehousesService({ db, audit, now }),
    docs: createStockDocsService({ db, audit, timezone: config.timezone, now }),
    balance: createStockBalanceService({ db, timezone: config.timezone, now }),
    postings: createStockPostingsService({ db, audit, operations }),
  });
  registerSavedFiltersRoutes(app, { savedFilters: createSavedFiltersService({ db, now }) });
  registerAttachmentsRoutes(app, { attachments: createAttachmentsService({ db, audit, uploadsDir: config.uploadsDir, now }) });
  registerBalancesRoutes(app, { companies, ledger: balances, rates, timezone: config.timezone, now });
  registerImportsRoutes(app, {
    imports: createImportsService({
      db,
      audit,
      rates,
      timezone: config.timezone,
      now,
      accounts,
      categories,
      counterparties,
      projects,
      tags,
      writer: createOperationsWriter(deps.sqlite),
    }),
  });
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
      if (req.url.startsWith('/api/') || req.url.startsWith('/pwa/') || req.method !== 'GET') {
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
