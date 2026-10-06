import type { FastifyInstance } from 'fastify';
import { projectCreateSchema, projectUpdateSchema } from '../../../shared/schemas/projects';
import { parseId } from '../../http/params';
import type { ProjectsService } from './service';

type P = { Params: { cid: string; id: string } };

export function registerProjectsRoutes(app: FastifyInstance, deps: { projects: ProjectsService }): void {
  const { projects } = deps;

  app.get<{ Params: { cid: string } }>('/api/v1/companies/:cid/projects', async (req) => ({
    projects: projects.list(parseId(req.params.cid)),
  }));

  app.post<{ Params: { cid: string } }>('/api/v1/companies/:cid/projects', async (req, reply) => {
    const cid = parseId(req.params.cid);
    const body = projectCreateSchema.parse(req.body);
    return reply.status(201).send(projects.create(cid, body, req.user!.id));
  });

  app.patch<P>('/api/v1/companies/:cid/projects/:id', async (req) => {
    const cid = parseId(req.params.cid);
    const id = parseId(req.params.id);
    const body = projectUpdateSchema.parse(req.body);
    return { project: projects.update(cid, id, body, req.user!.id) };
  });

  app.post<P>('/api/v1/companies/:cid/projects/:id/archive', async (req) => ({
    project: projects.archive(parseId(req.params.cid), parseId(req.params.id), req.user!.id),
  }));

  app.post<P>('/api/v1/companies/:cid/projects/:id/unarchive', async (req) => ({
    project: projects.unarchive(parseId(req.params.cid), parseId(req.params.id), req.user!.id),
  }));
}
