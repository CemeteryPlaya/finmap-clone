import { asc } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { decToString } from '../../../shared/decimal';
import {
  fixedRateCreateSchema,
  fixedRateUpdateSchema,
  manualRateCreateSchema,
  manualRateUpdateSchema,
  rateQuerySchema,
} from '../../../shared/schemas/rates';
import type { Db } from '../../db/client';
import { currencies } from '../../db/schema';
import { parseId } from '../../http/params';
import { rateUnavailable, type RatesService } from './service';

type P = { Params: { id: string } };
type CP = { Params: { cid: string; id: string } };

export function registerRatesRoutes(app: FastifyInstance, deps: { db: Db; rates: RatesService }): void {
  const { rates } = deps;

  app.get('/api/v1/currencies', async () => ({ currencies: deps.db.select().from(currencies).orderBy(asc(currencies.code)).all() }));

  app.get('/api/v1/rates', async (req) => {
    const q = rateQuerySchema.parse(req.query);
    const found = rates.kztRate(q.currency, q.date);
    if (!found) throw rateUnavailable(q.currency, q.date);
    return { rate: { currency: q.currency, date: q.date, rateToKzt: decToString(found.rate), effectiveDate: found.date, source: found.source } };
  });

  app.get('/api/v1/rates/manual', async () => ({ rates: rates.listManual() }));

  app.post('/api/v1/rates/manual', async (req, reply) => {
    const body = manualRateCreateSchema.parse(req.body);
    return reply.status(201).send({ rate: rates.addManual(body, req.user!.id) });
  });

  app.patch<P>('/api/v1/rates/manual/:id', async (req) => {
    const id = parseId(req.params.id);
    const { rate } = manualRateUpdateSchema.parse(req.body);
    return { rate: rates.updateManual(id, rate, req.user!.id) };
  });

  app.delete<P>('/api/v1/rates/manual/:id', async (req, reply) => {
    rates.removeManual(parseId(req.params.id), req.user!.id);
    return reply.status(204).send();
  });

  const FIXED = '/api/v1/companies/:cid/fixed-rates';

  app.get<{ Params: { cid: string } }>(FIXED, async (req) => ({ fixedRates: rates.listFixed(parseId(req.params.cid)) }));

  app.post<{ Params: { cid: string } }>(FIXED, async (req, reply) => {
    const cid = parseId(req.params.cid);
    const body = fixedRateCreateSchema.parse(req.body);
    return reply.status(201).send({ fixedRate: rates.addFixed(cid, body, req.user!.id) });
  });

  app.patch<CP>(`${FIXED}/:id`, async (req) => {
    const cid = parseId(req.params.cid);
    const id = parseId(req.params.id);
    const body = fixedRateUpdateSchema.parse(req.body);
    return { fixedRate: rates.updateFixed(cid, id, body, req.user!.id) };
  });

  app.delete<CP>(`${FIXED}/:id`, async (req, reply) => {
    rates.removeFixed(parseId(req.params.cid), parseId(req.params.id), req.user!.id);
    return reply.status(204).send();
  });
}
