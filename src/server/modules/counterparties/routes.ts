import type { FastifyInstance } from 'fastify';
import { reorderSchema } from '../../../shared/schemas/common';
import { counterpartyCreateSchema, counterpartyUpdateSchema } from '../../../shared/schemas/counterparties';
import { parseId } from '../../http/params';
import type { CounterpartiesService } from './service';

type C = { Params: { cid: string } };
type P = { Params: { cid: string; id: string } };
const BASE = '/api/v1/companies/:cid/counterparties';

export function registerCounterpartiesRoutes(app: FastifyInstance, deps: { counterparties: CounterpartiesService }): void {
  const svc = deps.counterparties;

  app.get<C>(BASE, async (req) => ({ counterparties: await svc.list(parseId(req.params.cid)) }));

  app.post<C>(BASE, async (req, reply) => {
    const cid = parseId(req.params.cid);
    const body = counterpartyCreateSchema.parse(req.body);
    return reply.status(201).send({ counterparty: await svc.add(cid, body, req.user!.id) });
  });

  app.post<C>(`${BASE}/reorder`, async (req) => {
    const cid = parseId(req.params.cid);
    const { ids } = reorderSchema.parse(req.body);
    return { counterparties: await svc.reorder(cid, ids, req.user!.id) };
  });

  app.patch<P>(`${BASE}/:id`, async (req) => {
    const cid = parseId(req.params.cid);
    const id = parseId(req.params.id);
    const body = counterpartyUpdateSchema.parse(req.body);
    return { counterparty: await svc.update(cid, id, body, req.user!.id) };
  });

  app.delete<P>(`${BASE}/:id`, async (req, reply) => {
    await svc.remove(parseId(req.params.cid), parseId(req.params.id), req.user!.id);
    return reply.status(204).send();
  });

  app.post<P>(`${BASE}/:id/archive`, async (req) => ({
    counterparty: await svc.archive(parseId(req.params.cid), parseId(req.params.id), req.user!.id),
  }));

  app.post<P>(`${BASE}/:id/unarchive`, async (req) => ({
    counterparty: await svc.unarchive(parseId(req.params.cid), parseId(req.params.id), req.user!.id),
  }));
}
