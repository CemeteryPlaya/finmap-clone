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
import { registerAnalyticsRoutes } from './modules/analytics/routes';
import { createAnalyticsService } from './modules/analytics/service';
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
import { registerCronRoutes } from './modules/cron/routes';
import { unavailableBackup, createBackupService, type BackupService } from './modules/backup/service';
import { LoginLimiter } from './modules/auth/login-limiter';
import { readSessionToken, registerAuth } from './modules/auth/plugin';
import { registerAuthRoutes } from './modules/auth/routes';
import { createSessionsService } from './modules/auth/sessions';
import { createLedgerBalances } from './modules/balances/service';
import { createOperationsReferences } from './modules/references/service';
import { createCategoriesService } from './modules/categories/service';
import { registerBalancesRoutes } from './modules/balances/routes';
import { createBlobStore } from './files/blob';
import { type Downloads, INLINE_MAX_BYTES } from './http/download';
import { createLocalStore } from './files/local';
import type { FileStore } from './files/store';
import { registerAttachmentsRoutes } from './modules/attachments/routes';
import type { ImportCache } from './modules/imports/cache';
import { registerImportsRoutes } from './modules/imports/routes';
import { createImportsService } from './modules/imports/service';
import { createAttachmentsService } from './modules/attachments/service';
import { createBulkService } from './modules/operations/bulk';
import { createJournal } from './modules/operations/journal';
import { registerOperationsRoutes } from './modules/operations/routes';
import { registerRatesRoutes } from './modules/rates/routes';
import { createOperationsService } from './modules/operations/service';
import { createOperationUndoService } from './modules/operations/undo';
import { createOperationsWriter } from './modules/operations/writer';
import { createRatesService } from './modules/rates/service';
import { registerSavedFiltersRoutes } from './modules/saved-filters/routes';
import { createSavedFiltersService } from './modules/saved-filters/service';
import { registerSplitPresetsRoutes } from './modules/split-presets/routes';
import { createStockAnalyticsService } from './modules/stock/analytics';
import { createStockBalanceService } from './modules/stock/balance';
import { createStockCatalogService } from './modules/stock/catalog';
import { createStockDocsService } from './modules/stock/docs';
import { createStockImportService } from './modules/stock/import';
import { createStockTemplateService } from './modules/stock/import-template';
import { createStockPostingsService } from './modules/stock/postings';
import { registerStockRoutes } from './modules/stock/routes';
import { createStockWarehousesService } from './modules/stock/warehouses';
import { createSplitPresetsService } from './modules/split-presets/service';
import { registerCompaniesRoutes } from './modules/companies/routes';
import { createCompaniesService } from './modules/companies/service';
import { registerUsersRoutes } from './modules/users/routes';
import { createUsersService } from './modules/users/service';
import { registerPreferencesRoutes } from './modules/preferences/routes';
import { registerUploadsRoutes } from './modules/uploads/routes';
import { registerPwaRoutes } from './pwa/routes';
import { createPreferencesService } from './modules/preferences/service';
import { resolveClientIp } from './security/client-ip';
import { registerCsrf } from './security/csrf';
import { installZodRu } from '../shared/zod-ru';

export interface AppDeps {
  config: Config;
  db: Db;
  /** Соединение better-sqlite3 — у SQLite; у Postgres null (запись импорта пачками, бэкап — своей реализацией). */
  sqlite: Sqlite | null;
  logger?: FastifyServerOptions['logger'];
  now?: () => Date;
  clientDir?: string;
  extraRoutes?: (app: FastifyInstance) => void;
  /** Общий сервис бэкапов процесса (startServer); без него приложение создаёт свой (тесты). */
  backup?: BackupService;
  /** Хранилище файлов; без него — Vercel Blob в режиме vercel, иначе папка uploads (тесты подменяют). */
  files?: FileStore;
  /** Кэш проверки импорта (тесты: промах кэша — другой экземпляр функции). */
  importCache?: ImportCache;
  /** Режим vercel: выгрузка больше этого — через хранилище и ссылку (по умолчанию 4 МБ; тесты снижают). */
  exportInlineMaxBytes?: number;
}

export async function buildApp(deps: AppDeps): Promise<FastifyInstance> {
  installZodRu();
  const { config, db } = deps;
  const now = deps.now ?? (() => new Date());
  // за прокси Vercel запросы приходят не с loopback (план 2026-10-20-vercel-postgres, Р14)
  const app = Fastify({ logger: deps.logger ?? false, trustProxy: config.deployMode === 'vercel' ? true : 'loopback', bodyLimit: 1024 * 1024 });

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
  // файлы: на Vercel браузер грузит их прямо в Blob (Р11) — тело запроса функции не больше 4,5 МБ
  const files = deps.files ?? (config.blobToken ? createBlobStore(config.blobToken) : createLocalStore(config.uploadsDir));
  const uploads = config.deployMode === 'vercel' && config.blobToken ? 'blob' : 'body';
  app.get('/api/v1/meta', async () => ({ appName: config.appName, timezone: config.timezone, uploads }));
  if (uploads === 'blob') registerUploadsRoutes(app, { blobToken: config.blobToken!, now });
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
  const journal = createJournal({ db, balances, timezone: config.timezone, now });
  // большие выгрузки на Vercel — через хранилище и ссылку (ответ функции не больше 4,5 МБ)
  const downloads: Downloads = { store: uploads === 'blob' ? files : null, inlineMax: deps.exportInlineMaxBytes ?? INLINE_MAX_BYTES };
  registerOperationsRoutes(app, { operations, journal, bulk: createBulkService({ db, operations }), undo: createOperationUndoService({ db, audit, operations }), downloads });
  registerAnalyticsRoutes(app, { analytics: createAnalyticsService({ db, rates, journal, audit, timezone: config.timezone, now }), downloads });
  const stockBalance = createStockBalanceService({ db, timezone: config.timezone, now });
  registerStockRoutes(app, {
    db,
    downloads,
    catalog: createStockCatalogService({ db, audit, timezone: config.timezone, now }),
    warehouses: createStockWarehousesService({ db, audit, now }),
    docs: createStockDocsService({ db, audit, timezone: config.timezone, now }),
    balance: stockBalance,
    postings: createStockPostingsService({ db, audit, operations }),
    imports: createStockImportService({ db, audit, timezone: config.timezone, now }),
    templates: createStockTemplateService({ db, timezone: config.timezone, now }),
    analytics: createStockAnalyticsService({ db, balance: stockBalance, timezone: config.timezone, now }),
  });
  registerSavedFiltersRoutes(app, { savedFilters: createSavedFiltersService({ db, now }) });
  registerAttachmentsRoutes(app, { attachments: createAttachmentsService({ db, audit, files, now }), files, stored: uploads === 'blob' });
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
      writer: createOperationsWriter(deps.sqlite ?? undefined),
      cache: deps.importCache,
      files: uploads === 'blob' ? files : undefined,
    }),
    stored: uploads === 'blob',
  });
  const backup =
    deps.backup ??
    (deps.sqlite
      ? createBackupService({
          sqlite: deps.sqlite,
          config,
          now,
          log: (m, e) => (e ? app.log.error({ err: e }, m) : app.log.info(m)),
        })
      : unavailableBackup());
  const cloud = uploads === 'blob' ? { files, timezone: config.timezone, now } : undefined;
  registerBackupRoutes(app, { backup, db, keep: config.backupKeep, cloud });
  if (cloud && config.cronSecret) registerCronRoutes(app, { ...cloud, db, keep: config.backupKeep, secret: config.cronSecret });

  // интерфейс отдаёт приложение — и на Vercel: у Fastify Vercel не отдаёт public/ с CDN, dist/client едет в бандле функции.
  // Файлы assets/ с хэшем в имени не меняются — кэш на год
  const clientDir = deps.clientDir ?? path.resolve('dist', 'client');
  if (fs.existsSync(path.join(clientDir, 'index.html'))) {
    await app.register(fastifyStatic, {
      root: clientDir,
      prefix: '/',
      wildcard: false,
      cacheControl: false,
      setHeaders: (reply, file) => {
        reply.header('cache-control', /(^|[\\/])assets[\\/][^\\/]+$/.test(file) ? 'public, max-age=31536000, immutable' : 'public, max-age=0');
      },
    });
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
