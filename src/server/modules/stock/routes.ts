import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import {
  stockBalanceSchema,
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
import { parseId } from '../../http/params';
import type { StockBalanceService } from './balance';
import type { StockCatalogService } from './catalog';
import type { StockDocsService } from './docs';
import { unpaidDocs } from './payments';
import type { StockPostingsService } from './postings';
import type { StockWarehousesService } from './warehouses';

type C = { Params: { cid: string } };
type P = { Params: { cid: string; id: string } };
const BASE = '/api/v1/companies/:cid/stock';

export function registerStockRoutes(app: FastifyInstance, deps: { db: Db; catalog: StockCatalogService; warehouses: StockWarehousesService; docs: StockDocsService; balance: StockBalanceService; postings: StockPostingsService }): void {
  const { db, catalog, warehouses, docs, balance, postings } = deps;

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
    const body = stockDocCreateSchema.parse(req.body);
    const out = docs.create(parseId(req.params.cid), body, req.user!.id);
    return reply.status(body.dryRun ? 200 : 201).send(out);
  });

  app.patch<P>(`${BASE}/docs/:id`, async (req) => {
    const body = stockDocUpdateSchema.parse(req.body);
    return docs.update(parseId(req.params.cid), parseId(req.params.id), body, req.user!.id);
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
