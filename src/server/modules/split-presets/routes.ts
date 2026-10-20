import type { FastifyInstance } from 'fastify';
import { reorderSchema } from '../../../shared/schemas/common';
import { splitPresetCreateSchema, splitPresetUpdateSchema } from '../../../shared/schemas/split-presets';
import { parseId } from '../../http/params';
import type { SplitPresetsService } from './service';

type C = { Params: { cid: string } };
type P = { Params: { cid: string; id: string } };
const BASE = '/api/v1/companies/:cid/split-presets';

export function registerSplitPresetsRoutes(app: FastifyInstance, deps: { splitPresets: SplitPresetsService }): void {
  const svc = deps.splitPresets;

  app.get<C>(BASE, async (req) => ({ splitPresets: await svc.list(parseId(req.params.cid)) }));

  app.post<C>(BASE, async (req, reply) => {
    const cid = parseId(req.params.cid);
    const body = splitPresetCreateSchema.parse(req.body);
    return reply.status(201).send({ splitPreset: await svc.add(cid, body, req.user!.id) });
  });

  app.post<C>(`${BASE}/reorder`, async (req) => {
    const cid = parseId(req.params.cid);
    const { ids } = reorderSchema.parse(req.body);
    return { splitPresets: await svc.reorder(cid, ids, req.user!.id) };
  });

  app.patch<P>(`${BASE}/:id`, async (req) => {
    const cid = parseId(req.params.cid);
    const id = parseId(req.params.id);
    const body = splitPresetUpdateSchema.parse(req.body);
    return { splitPreset: await svc.update(cid, id, body, req.user!.id) };
  });

  app.delete<P>(`${BASE}/:id`, async (req, reply) => {
    await svc.remove(parseId(req.params.cid), parseId(req.params.id), req.user!.id);
    return reply.status(204).send();
  });

  app.post<P>(`${BASE}/:id/archive`, async (req) => ({
    splitPreset: await svc.archive(parseId(req.params.cid), parseId(req.params.id), req.user!.id),
  }));

  app.post<P>(`${BASE}/:id/unarchive`, async (req) => ({
    splitPreset: await svc.unarchive(parseId(req.params.cid), parseId(req.params.id), req.user!.id),
  }));
}
