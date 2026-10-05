import Fastify, { type FastifyInstance, type FastifyServerOptions } from 'fastify';
import type { Config } from './config';
import type { Db, Sqlite } from './db/client';
import { registerErrorHandler } from './errors';

export interface AppDeps {
  config: Config;
  db: Db;
  sqlite: Sqlite;
  logger?: FastifyServerOptions['logger'];
  now?: () => Date;
  extraRoutes?: (app: FastifyInstance) => void;
}

export async function buildApp(deps: AppDeps): Promise<FastifyInstance> {
  const { config } = deps;
  const app = Fastify({
    logger: deps.logger ?? false,
    trustProxy: 'loopback',
    bodyLimit: 1024 * 1024,
  });

  registerErrorHandler(app);

  app.get('/api/v1/health', async () => ({ ok: true }));
  app.get('/api/v1/meta', async () => ({ appName: config.appName }));

  deps.extraRoutes?.(app);
  return app;
}
