import type { FastifyInstance } from 'fastify';
import { senetCheckSchema, senetConnectionCreateSchema, senetConnectionPatchSchema, senetOfficeSchema } from '../../../shared/schemas/senet';
import { parseId } from '../../http/params';
import type { SenetConnections } from './connections';

type C = { Params: { cid: string } };
type P = { Params: { cid: string; id: string } };
const BASE = '/api/v1/companies/:cid/senet';

/** Senet (спецификация 2026-11-02-senet-autopost): подключения и клубы. */
export function registerSenetRoutes(app: FastifyInstance, deps: { connections: SenetConnections }): void {
  const svc = deps.connections;

  app.get<C>(`${BASE}/connections`, async (req) => ({ connections: await svc.list(parseId(req.params.cid)) }));

  app.post<C>(`${BASE}/connections/check`, async (req) => svc.check(parseId(req.params.cid), senetCheckSchema.parse(req.body)));

  app.post<C>(`${BASE}/connections`, async (req, reply) => {
    const connection = await svc.create(parseId(req.params.cid), senetConnectionCreateSchema.parse(req.body), req.user!.id);
    return reply.status(201).send({ connection });
  });

  app.patch<P>(`${BASE}/connections/:id`, async (req) => ({
    connection: await svc.update(parseId(req.params.cid), parseId(req.params.id), senetConnectionPatchSchema.parse(req.body), req.user!.id),
  }));

  app.delete<P>(`${BASE}/connections/:id`, async (req, reply) => {
    await svc.remove(parseId(req.params.cid), parseId(req.params.id), req.user!.id);
    return reply.status(204).send();
  });

  app.post<P>(`${BASE}/connections/:id/offices`, async (req, reply) => {
    const office = await svc.createOffice(parseId(req.params.cid), parseId(req.params.id), senetOfficeSchema.parse(req.body), req.user!.id);
    return reply.status(201).send({ office });
  });

  app.patch<P>(`${BASE}/offices/:id`, async (req) => ({
    office: await svc.updateOffice(parseId(req.params.cid), parseId(req.params.id), senetOfficeSchema.parse(req.body), req.user!.id),
  }));
}
