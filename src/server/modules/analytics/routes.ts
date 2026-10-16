import type { FastifyInstance } from 'fastify';
import { cellQuerySchema, reportQuerySchema } from '../../../shared/schemas/analytics';
import { parseId } from '../../http/params';
import type { AnalyticsService } from './service';

type C = { Params: { cid: string } };
const BASE = '/api/v1/companies/:cid/analytics';

/** «Аналитика» (§9 спецификации «Аналитика»): только чтение, сессия, компания из адреса (архивная тоже читается). */
export function registerAnalyticsRoutes(app: FastifyInstance, deps: { analytics: AnalyticsService }): void {
  const { analytics } = deps;

  app.get<C>(`${BASE}/cashflow`, async (req) => analytics.cashflow(parseId(req.params.cid), reportQuerySchema.parse(req.query)));

  app.get<C>(`${BASE}/pnl`, async (req) => analytics.pnl(parseId(req.params.cid), reportQuerySchema.parse(req.query)));

  app.get<C>(`${BASE}/operations`, async (req) => analytics.operations(parseId(req.params.cid), cellQuerySchema.parse(req.query)));
}
