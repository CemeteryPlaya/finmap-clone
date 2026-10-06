import type { FastifyInstance } from 'fastify';
import { reorderSchema } from '../../../shared/schemas/common';
import { projectCreateSchema, projectUpdateSchema } from '../../../shared/schemas/projects';
import { parseId } from '../../http/params';
import type { ProjectsService } from './service';

type C = { Params: { cid: string } };
type P = { Params: { cid: string; id: string } };
const BASE = '/api/v1/companies/:cid/projects';

export function registerProjectsRoutes(app: FastifyInstance, deps: { projects: ProjectsService }): void {
  const { projects } = deps;

  app.get<C>(BASE, async (req) => ({ projects: projects.list(parseId(req.params.cid)) }));

  app.post<C>(BASE, async (req, reply) => {
    const cid = parseId(req.params.cid);
    const body = projectCreateSchema.parse(req.body);
    return reply.status(201).send(projects.create(cid, body, req.user!.id));
  });

  app.post<C>(`${BASE}/reorder`, async (req) => {
    const cid = parseId(req.params.cid);
    const { ids } = reorderSchema.parse(req.body);
    return { projects: projects.reorder(cid, ids, req.user!.id) };
  });

  app.patch<P>(`${BASE}/:id`, async (req) => {
    const cid = parseId(req.params.cid);
    const id = parseId(req.params.id);
    const body = projectUpdateSchema.parse(req.body);
    return projects.update(cid, id, body, req.user!.id);
  });

  app.delete<P>(`${BASE}/:id`, async (req, reply) => {
    projects.remove(parseId(req.params.cid), parseId(req.params.id), req.user!.id);
    return reply.status(204).send();
  });

  app.post<P>(`${BASE}/:id/archive`, async (req) => ({
    project: projects.archive(parseId(req.params.cid), parseId(req.params.id), req.user!.id),
  }));

  app.post<P>(`${BASE}/:id/unarchive`, async (req) => ({
    project: projects.unarchive(parseId(req.params.cid), parseId(req.params.id), req.user!.id),
  }));
}
