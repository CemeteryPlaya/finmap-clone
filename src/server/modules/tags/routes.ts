import type { FastifyInstance } from 'fastify';
import { reorderSchema } from '../../../shared/schemas/common';
import { tagSchema } from '../../../shared/schemas/tags';
import { parseId } from '../../http/params';
import type { TagsService } from './service';

type C = { Params: { cid: string } };
type P = { Params: { cid: string; id: string } };
const BASE = '/api/v1/companies/:cid/tags';

export function registerTagsRoutes(app: FastifyInstance, deps: { tags: TagsService }): void {
  const svc = deps.tags;

  app.get<C>(BASE, async (req) => ({ tags: await svc.list(parseId(req.params.cid)) }));

  app.post<C>(BASE, async (req, reply) => {
    const cid = parseId(req.params.cid);
    const { name } = tagSchema.parse(req.body);
    return reply.status(201).send({ tag: await svc.add(cid, name, req.user!.id) });
  });

  app.post<C>(`${BASE}/reorder`, async (req) => {
    const cid = parseId(req.params.cid);
    const { ids } = reorderSchema.parse(req.body);
    return { tags: await svc.reorder(cid, ids, req.user!.id) };
  });

  app.patch<P>(`${BASE}/:id`, async (req) => {
    const cid = parseId(req.params.cid);
    const id = parseId(req.params.id);
    const { name } = tagSchema.parse(req.body);
    return { tag: await svc.rename(cid, id, name, req.user!.id) };
  });

  app.delete<P>(`${BASE}/:id`, async (req, reply) => {
    await svc.remove(parseId(req.params.cid), parseId(req.params.id), req.user!.id);
    return reply.status(204).send();
  });

  app.post<P>(`${BASE}/:id/archive`, async (req) => ({
    tag: await svc.archive(parseId(req.params.cid), parseId(req.params.id), req.user!.id),
  }));

  app.post<P>(`${BASE}/:id/unarchive`, async (req) => ({
    tag: await svc.unarchive(parseId(req.params.cid), parseId(req.params.id), req.user!.id),
  }));
}
