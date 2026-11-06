import type { FastifyInstance } from 'fastify';
import type { Db } from '../../db/client';
import { guestCardQuerySchema, guestLinkInputSchema, guestSearchQuerySchema, guestsQuerySchema, loadQuerySchema, loadRowsQuerySchema, overviewQuerySchema, revenueQuerySchema, revenueRowsQuerySchema, zonesInputSchema } from '../../../shared/schemas/club-analytics';
import { type Downloads, inlineDownloads, sendFile } from '../../http/download';
import { parseId } from '../../http/params';
import type { GuestLinksService } from './guest-links';
import type { ClubGuests } from './guests';
import type { ClubLoad } from './load';
import type { ClubOverview } from './overview';
import type { ClubRevenue } from './revenue';
import { requireCompany } from '../companies/guard';
import { clubScope } from './scope';
import type { AnalyticsSettings } from './settings';
import type { ClubZones } from './zones';

type K = { Params: { cid: string; key: string } };
type C = { Params: { cid: string } };
type O = { Params: { cid: string; id: string } };

/**
 * «Аналитика клуба» (спецификация 2026-11-03-club-analytics): настройки дашбордов компании (§10) и отчёты клуба. Чтение —
 * сессия, архивная компания тоже читается; запись — CSRF, архивная компания — только чтение.
 */
export function registerClubAnalyticsRoutes(app: FastifyInstance, deps: { db: Db; settings: AnalyticsSettings; overview: ClubOverview; revenue: ClubRevenue; load: ClubLoad; zones: ClubZones; links: GuestLinksService; guests: ClubGuests; downloads?: Downloads }): void {
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

  // зоны клуба Senet (§6.1): места ПК по данным и свои
  const ZONES = '/api/v1/companies/:cid/senet/offices/:id/zones';
  app.get<O>(ZONES, async (req) => ({ zones: await deps.zones.list(parseId(req.params.cid), parseId(req.params.id)) }));
  app.put<O>(ZONES, async (req) => ({ zones: await deps.zones.put(parseId(req.params.cid), parseId(req.params.id), zonesInputSchema.parse(req.body), req.user!.id) }));

  // «Обзор клуба» (§4): плитки, ряд по дням; Excel — плитки и ряд
  app.get<C>(`${BASE}/overview`, async (req) => deps.overview.overview(parseId(req.params.cid), overviewQuerySchema.parse(req.query)));
  app.get<C>(`${BASE}/overview.xlsx`, async (req, reply) => sendFile(reply, await deps.overview.xlsx(parseId(req.params.cid), overviewQuerySchema.parse(req.query)), deps.downloads ?? inlineDownloads));

  // «Выручка клуба» (§5, §11): таблица, строки ячейки, Excel — ссылка без побочных эффектов
  app.get<C>(`${BASE}/revenue`, async (req) => deps.revenue.revenue(parseId(req.params.cid), revenueQuerySchema.parse(req.query)));
  app.get<C>(`${BASE}/revenue/rows`, async (req) => deps.revenue.rows(parseId(req.params.cid), revenueRowsQuerySchema.parse(req.query)));
  app.get<C>(`${BASE}/revenue.xlsx`, async (req, reply) => sendFile(reply, await deps.revenue.xlsx(parseId(req.params.cid), revenueQuerySchema.parse(req.query)), deps.downloads ?? inlineDownloads));

  // «Гости» (§7, §11): отчёт, Excel
  app.get<C>(`${BASE}/guests`, async (req) => deps.guests.guests(parseId(req.params.cid), guestsQuerySchema.parse(req.query)));
  app.get<C>(`${BASE}/guests.xlsx`, async (req, reply) => sendFile(reply, await deps.guests.xlsx(parseId(req.params.cid), guestsQuerySchema.parse(req.query)), deps.downloads ?? inlineDownloads));

  // поиск гостей для «Это один гость» и карточка гостя (§7.1, §7.4); поиск — раньше карточки
  app.get<C>(`${BASE}/guests/search`, async (req) => deps.guests.search(parseId(req.params.cid), guestSearchQuerySchema.parse(req.query).q));
  app.get<{ Params: { cid: string; guest: string } }>(`${BASE}/guests/:guest`, async (req) => deps.guests.card(parseId(req.params.cid), req.params.guest, guestCardQuerySchema.parse(req.query)));

  // правки гостей (§7.1, §11): «Это один гость», «Разделить», снять правку
  app.post<C>(`${BASE}/guests/links`, async (req) => deps.links.create(parseId(req.params.cid), guestLinkInputSchema.parse(req.body), req.user!.id));
  app.delete<O>(`${BASE}/guests/links/:id`, async (req, reply) => {
    await deps.links.remove(parseId(req.params.cid), parseId(req.params.id), req.user!.id);
    return reply.code(204).send();
  });

  // «Загрузка» (§6, §11): отчёт, сеансы ячейки карты, Excel
  app.get<C>(`${BASE}/load`, async (req) => deps.load.load(parseId(req.params.cid), loadQuerySchema.parse(req.query)));
  app.get<C>(`${BASE}/load/rows`, async (req) => deps.load.rows(parseId(req.params.cid), loadRowsQuerySchema.parse(req.query)));
  app.get<C>(`${BASE}/load.xlsx`, async (req, reply) => sendFile(reply, await deps.load.xlsx(parseId(req.params.cid), loadQuerySchema.parse(req.query)), deps.downloads ?? inlineDownloads));
}
