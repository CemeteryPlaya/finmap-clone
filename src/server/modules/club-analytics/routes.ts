import type { FastifyInstance } from 'fastify';
import { parseId } from '../../http/params';
import type { AnalyticsSettings } from './settings';

type K = { Params: { cid: string; key: string } };
type C = { Params: { cid: string } };

/**
 * «Аналитика клуба» (спецификация 2026-11-03-club-analytics): настройки дашбордов компании (§10). Чтение — сессия,
 * архивная компания тоже читается; запись — CSRF, архивная компания — только чтение.
 */
export function registerClubAnalyticsRoutes(app: FastifyInstance, deps: { settings: AnalyticsSettings }): void {
  const SETTINGS = '/api/v1/companies/:cid/analytics-settings';
  app.get<C>(SETTINGS, async (req) => deps.settings.get(parseId(req.params.cid)));
  app.put<K>(`${SETTINGS}/:key`, async (req) => deps.settings.put(parseId(req.params.cid), req.params.key, req.body, req.user!.id));
  app.delete<K>(`${SETTINGS}/:key`, async (req) => deps.settings.reset(parseId(req.params.cid), req.params.key, req.user!.id));
}
