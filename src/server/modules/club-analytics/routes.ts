import type { FastifyInstance } from 'fastify';
import type { Db } from '../../db/client';
import { revenueQuerySchema, revenueRowsQuerySchema } from '../../../shared/schemas/club-analytics';
import { type Downloads, inlineDownloads, sendFile } from '../../http/download';
import { parseId } from '../../http/params';
import type { ClubRevenue } from './revenue';
import { requireCompany } from '../companies/guard';
import { clubScope } from './scope';
import type { AnalyticsSettings } from './settings';

type K = { Params: { cid: string; key: string } };
type C = { Params: { cid: string } };

/**
 * «Аналитика клуба» (спецификация 2026-11-03-club-analytics): настройки дашбордов компании (§10) и отчёты клуба. Чтение —
 * сессия, архивная компания тоже читается; запись — CSRF, архивная компания — только чтение.
 */
export function registerClubAnalyticsRoutes(app: FastifyInstance, deps: { db: Db; settings: AnalyticsSettings; revenue: ClubRevenue; downloads?: Downloads }): void {
  const SETTINGS = '/api/v1/companies/:cid/analytics-settings';
  app.get<C>(SETTINGS, async (req) => deps.settings.get(parseId(req.params.cid)));
  app.put<K>(`${SETTINGS}/:key`, async (req) => deps.settings.put(parseId(req.params.cid), req.params.key, req.body, req.user!.id));
  app.delete<K>(`${SETTINGS}/:key`, async (req) => deps.settings.reset(parseId(req.params.cid), req.params.key, req.user!.id));

  const BASE = '/api/v1/companies/:cid/club-analytics';
  // клубы компании для карточек и списка «Клуб» (§2.1–2.2): клубы Senet наружу не отдаются — только есть ли они
  app.get<C>(`${BASE}/scope`, async (req) => {
    const cid = parseId(req.params.cid);
    await requireCompany(deps.db, cid);
    const { offices, ...rest } = await clubScope(deps.db, cid);
    return { projects: rest.projects, hasOffices: offices.length > 0, connected: rest.connected, freshness: rest.freshness };
  });

  // «Выручка клуба» (§5, §11): таблица, строки ячейки, Excel — ссылка без побочных эффектов
  app.get<C>(`${BASE}/revenue`, async (req) => deps.revenue.revenue(parseId(req.params.cid), revenueQuerySchema.parse(req.query)));
  app.get<C>(`${BASE}/revenue/rows`, async (req) => deps.revenue.rows(parseId(req.params.cid), revenueRowsQuerySchema.parse(req.query)));
  app.get<C>(`${BASE}/revenue.xlsx`, async (req, reply) => sendFile(reply, await deps.revenue.xlsx(parseId(req.params.cid), revenueQuerySchema.parse(req.query)), deps.downloads ?? inlineDownloads));
}
