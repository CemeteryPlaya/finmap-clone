import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import {
  STOCK_IMPORT_MAX_BYTES,
  stockAnalyticsSchema,
  stockBalanceSchema,
  stockListsSchema,
  stockCountCreateSchema,
  stockCountPostSchema,
  stockCountUpdateSchema,
  stockDocCreateSchema,
  stockDocListSchema,
  stockDocUpdateSchema,
  stockGroupSchema,
  stockItemCreateSchema,
  stockItemUpdateSchema,
  stockJournalSchema,
  stockPriceSchema,
  stockWarehouseCreateSchema,
  stockWarehouseUpdateSchema,
} from '../../../shared/schemas/stock';
import type { Db } from '../../db/client';
import { AppError } from '../../errors';
import { headerFileName, parseId } from '../../http/params';
import { readSessionToken } from '../auth/plugin';
import { contentDisposition } from '../../http/content-disposition';
import { XLSX_MIME } from '../../http/xlsx';
import type { StockAnalyticsService } from './analytics';
import type { StockImportService } from './import';
import type { StockTemplateService } from './import-template';
import type { StockBalanceService } from './balance';
import type { StockCatalogService } from './catalog';
import type { StockDocsService } from './docs';
import { unpaidDocs } from './payments';
import type { StockPostingsService } from './postings';
import type { StockWarehousesService } from './warehouses';

type C = { Params: { cid: string } };
type P = { Params: { cid: string; id: string } };
const BASE = '/api/v1/companies/:cid/stock';

export function registerStockRoutes(
  app: FastifyInstance,
  deps: {
    db: Db;
    catalog: StockCatalogService;
    warehouses: StockWarehousesService;
    docs: StockDocsService;
    balance: StockBalanceService;
    postings: StockPostingsService;
    imports: StockImportService;
    templates: StockTemplateService;
    analytics: StockAnalyticsService;
  },
): void {
  const { db, catalog, warehouses, docs, balance, postings, imports, templates, analytics } = deps;

  // ---- шаблон импорта (спецификация 2026-10-19, часть 4): собирается по текущим группам, товарам и поставщикам
  app.get<{ Params: { cid: string; kind: string } }>(`${BASE}/import/:kind/template.xlsx`, async (req, reply) => {
    const kind = z.enum(['items', 'receipts']).safeParse(req.params.kind);
    if (!kind.success) throw new AppError(404, 'NOT_FOUND', 'Неизвестный вид импорта');
    const file = templates.template(parseId(req.params.cid), kind.data);
    reply.header('Content-Type', XLSX_MIME);
    reply.header('Content-Disposition', contentDisposition(file.fileName));
    reply.header('X-Content-Type-Options', 'nosniff');
    reply.header('Cache-Control', 'private, no-store');
    return reply.send(file.data);
  });

  // ---- аналитика склада (§8, план Склад-3)
  app.get<C>(`${BASE}/analytics/items`, async (req) => analytics.items(parseId(req.params.cid), stockAnalyticsSchema.parse(req.query)));
  app.get<C>(`${BASE}/analytics/lists`, async (req) => analytics.lists(parseId(req.params.cid), stockListsSchema.parse(req.query)));
  app.get<P>(`${BASE}/analytics/prices/:id`, async (req) => analytics.prices(parseId(req.params.cid), parseId(req.params.id), stockAnalyticsSchema.parse(req.query)));
  app.get<C>(`${BASE}/analytics/export.xlsx`, async (req, reply) => {
    const file = analytics.exportXlsx(parseId(req.params.cid), stockAnalyticsSchema.parse(req.query));
    reply.header('Content-Type', XLSX_MIME);
    reply.header('Content-Disposition', contentDisposition(file.fileName));
    reply.header('X-Content-Type-Options', 'nosniff');
    reply.header('Cache-Control', 'private, no-store');
    return reply.send(file.data);
  });

  // ---- импорт каталога и поступлений (§9.1): байты файла, отдельная область с пределом 5 МБ
  app.register(async (scope) => {
    scope.removeAllContentTypeParsers();
    scope.addContentTypeParser('application/octet-stream', { parseAs: 'buffer', bodyLimit: STOCK_IMPORT_MAX_BYTES }, (_req, body, done) => done(null, body));
    // без куки сессии тело не читаем: полная проверка сеанса — как у всех маршрутов
    scope.addHook('onRequest', async (req) => {
      if (req.method === 'POST' && !readSessionToken(req)) throw new AppError(401, 'UNAUTHORIZED', 'Требуется вход');
    });
    scope.post<{ Params: { cid: string; kind: string } }>(`${BASE}/import/:kind`, { bodyLimit: STOCK_IMPORT_MAX_BYTES }, async (req, reply) => {
      const kind = z.enum(['items', 'receipts']).safeParse(req.params.kind);
      if (!kind.success) throw new AppError(404, 'NOT_FOUND', 'Неизвестный вид импорта');
      if (!Buffer.isBuffer(req.body)) throw new AppError(400, 'VALIDATION', 'Проверьте файл', { file: 'Нет файла' });
      const q = z.object({ commit: z.enum(['0', '1']).default('0'), warehouse: z.coerce.number().int().positive().optional() }).parse(req.query);
      const result = imports.run(parseId(req.params.cid), req.user!.id, kind.data, { name: headerFileName(req.headers['x-file-name']), data: req.body }, {
        warehouseId: q.warehouse,
        commit: q.commit === '1',
      });
      return reply.status(result.committed ? 201 : 200).send(result);
    });
  });

  // ---- группы товаров
  app.get<C>(`${BASE}/groups`, async (req) => ({ groups: catalog.groups(parseId(req.params.cid)) }));

  app.post<C>(`${BASE}/groups`, async (req, reply) => {
    const { name } = stockGroupSchema.parse(req.body);
    return reply.status(201).send({ group: catalog.addGroup(parseId(req.params.cid), name, req.user!.id) });
  });

  app.patch<P>(`${BASE}/groups/:id`, async (req) => {
    const { name } = stockGroupSchema.parse(req.body);
    return { group: catalog.renameGroup(parseId(req.params.cid), parseId(req.params.id), name, req.user!.id) };
  });

  app.post<P>(`${BASE}/groups/:id/archive`, async (req) => ({
    group: catalog.archiveGroup(parseId(req.params.cid), parseId(req.params.id), req.user!.id),
  }));

  app.post<P>(`${BASE}/groups/:id/unarchive`, async (req) => ({
    group: catalog.unarchiveGroup(parseId(req.params.cid), parseId(req.params.id), req.user!.id),
  }));

  // ---- товары
  app.get<C>(`${BASE}/items`, async (req) => ({ items: catalog.items(parseId(req.params.cid)) }));

  app.post<C>(`${BASE}/items`, async (req, reply) => {
    const body = stockItemCreateSchema.parse(req.body);
    return reply.status(201).send({ item: catalog.addItem(parseId(req.params.cid), body, req.user!.id) });
  });

  app.get<P>(`${BASE}/items/:id`, async (req) => ({ item: catalog.item(parseId(req.params.cid), parseId(req.params.id)) }));

  app.patch<P>(`${BASE}/items/:id`, async (req) => {
    const body = stockItemUpdateSchema.parse(req.body);
    return { item: catalog.updateItem(parseId(req.params.cid), parseId(req.params.id), body, req.user!.id) };
  });

  app.post<P>(`${BASE}/items/:id/price`, async (req) => {
    const body = stockPriceSchema.parse(req.body);
    return { item: catalog.setPrice(parseId(req.params.cid), parseId(req.params.id), body, req.user!.id) };
  });

  app.post<P>(`${BASE}/items/:id/archive`, async (req) => ({
    item: catalog.archiveItem(parseId(req.params.cid), parseId(req.params.id), req.user!.id),
  }));

  app.post<P>(`${BASE}/items/:id/unarchive`, async (req) => ({
    item: catalog.unarchiveItem(parseId(req.params.cid), parseId(req.params.id), req.user!.id),
  }));

  app.delete<P>(`${BASE}/items/:id`, async (req, reply) => {
    catalog.removeItem(parseId(req.params.cid), parseId(req.params.id), req.user!.id);
    return reply.status(204).send();
  });

  // ---- склады
  app.get<C>(`${BASE}/warehouses`, async (req) => ({ warehouses: warehouses.list(parseId(req.params.cid)) }));

  app.post<C>(`${BASE}/warehouses`, async (req, reply) => {
    const body = stockWarehouseCreateSchema.parse(req.body);
    return reply.status(201).send({ warehouse: warehouses.create(parseId(req.params.cid), body, req.user!.id) });
  });

  app.patch<P>(`${BASE}/warehouses/:id`, async (req) => {
    const { name } = stockWarehouseUpdateSchema.parse(req.body);
    return { warehouse: warehouses.rename(parseId(req.params.cid), parseId(req.params.id), name, req.user!.id) };
  });

  app.post<P>(`${BASE}/warehouses/:id/archive`, async (req) => ({
    warehouse: warehouses.archive(parseId(req.params.cid), parseId(req.params.id), req.user!.id),
  }));

  app.post<P>(`${BASE}/warehouses/:id/unarchive`, async (req) => ({
    warehouse: warehouses.unarchive(parseId(req.params.cid), parseId(req.params.id), req.user!.id),
  }));

  // ---- документы
  app.get<C>(`${BASE}/docs`, async (req) => docs.list(parseId(req.params.cid), stockDocListSchema.parse(req.query)));

  app.get<P>(`${BASE}/docs/:id`, async (req) => ({ doc: docs.get(parseId(req.params.cid), parseId(req.params.id)) }));

  app.post<C>(`${BASE}/docs`, async (req, reply) => {
    // инвентаризация — своё тело: черновик со строками «товар — факт» (§7)
    const raw = req.body as { type?: unknown; dryRun?: unknown } | null;
    if (raw?.type === 'count') {
      // черновик в FIFO не участвует: пробного расчёта у инвентаризации нет
      if (raw.dryRun === true) throw new AppError(400, 'VALIDATION', 'Проверьте заполнение полей', { dryRun: 'У инвентаризации нет пробного расчёта' });
      const doc = docs.createCount(parseId(req.params.cid), stockCountCreateSchema.parse(req.body), req.user!.id);
      return reply.status(201).send({ doc, impact: { sales: 0, writeoffs: 0, since: null } });
    }
    const body = stockDocCreateSchema.parse(req.body);
    const out = docs.create(parseId(req.params.cid), body, req.user!.id);
    return reply.status(body.dryRun ? 200 : 201).send(out);
  });

  // схема тела — по типу документа (R15): у инвентаризации своя
  app.patch<P>(`${BASE}/docs/:id`, async (req) => {
    const cid = parseId(req.params.cid);
    const id = parseId(req.params.id);
    if (docs.typeOf(cid, id) === 'count') {
      return { doc: docs.updateCount(cid, id, stockCountUpdateSchema.parse(req.body), req.user!.id), impact: { sales: 0, writeoffs: 0, since: null } };
    }
    return docs.update(cid, id, stockDocUpdateSchema.parse(req.body), req.user!.id);
  });

  // «Провести» инвентаризацию
  app.post<P>(`${BASE}/docs/:id/post`, async (req) => {
    const { version } = stockCountPostSchema.parse(req.body);
    return { doc: docs.post(parseId(req.params.cid), parseId(req.params.id), version, req.user!.id) };
  });

  // ?dryRun=1 — только последствия, документ остаётся
  app.delete<P>(`${BASE}/docs/:id`, async (req) => {
    const { dryRun } = z.object({ dryRun: z.enum(['1', '0']).optional() }).parse(req.query);
    return docs.remove(parseId(req.params.cid), parseId(req.params.id), req.user!.id, { dryRun: dryRun === '1' });
  });

  // продажа → доход журнала (§6.3)
  app.post<P>(`${BASE}/docs/:id/journal`, async (req, reply) => {
    const cid = parseId(req.params.cid);
    const id = parseId(req.params.id);
    const { operationId } = postings.post(cid, id, stockJournalSchema.parse(req.body), req.user!.id);
    return reply.status(201).send({ operationId, doc: docs.get(cid, id) });
  });

  // ---- оплата закупок: поступления поставщика с долгом (§6.1)
  app.get<P>(`${BASE}/suppliers/:id/unpaid`, async (req) => {
    const { operationId } = z.object({ operationId: z.coerce.number().int().positive().optional() }).parse(req.query);
    return unpaidDocs(db, parseId(req.params.cid), parseId(req.params.id), operationId ?? null);
  });

  // ---- остатки и стоимость
  app.get<C>(`${BASE}/balance`, async (req) => balance.balance(parseId(req.params.cid), stockBalanceSchema.parse(req.query)));

  app.get<C>(`${BASE}/value`, async (req) => balance.value(parseId(req.params.cid)));
}
