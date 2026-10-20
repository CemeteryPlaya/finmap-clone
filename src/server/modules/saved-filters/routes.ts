import type { FastifyInstance } from 'fastify';
import { savedFilterCreateSchema, savedFilterUpdateSchema } from '../../../shared/schemas/saved-filters';
import { parseId } from '../../http/params';
import type { SavedFiltersService } from './service';

type C = { Params: { cid: string } };
type P = { Params: { cid: string; id: string } };
const BASE = '/api/v1/companies/:cid/saved-filters';

export function registerSavedFiltersRoutes(app: FastifyInstance, deps: { savedFilters: SavedFiltersService }): void {
  const svc = deps.savedFilters;

  app.get<C>(BASE, async (req) => ({ savedFilters: await svc.list(req.user!.id, parseId(req.params.cid)) }));

  app.post<C>(BASE, async (req, reply) => {
    const cid = parseId(req.params.cid);
    const body = savedFilterCreateSchema.parse(req.body);
    return reply.status(201).send({ savedFilter: await svc.add(req.user!.id, cid, body) });
  });

  app.patch<P>(`${BASE}/:id`, async (req) => {
    const cid = parseId(req.params.cid);
    const id = parseId(req.params.id);
    const body = savedFilterUpdateSchema.parse(req.body);
    return { savedFilter: await svc.update(req.user!.id, cid, id, body) };
  });

  app.delete<P>(`${BASE}/:id`, async (req, reply) => {
    await svc.remove(req.user!.id, parseId(req.params.cid), parseId(req.params.id));
    return reply.status(204).send();
  });
}
