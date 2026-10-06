import type { FastifyInstance } from 'fastify';
import { categoryCreateSchema, categoryReorderSchema, categoryUpdateSchema } from '../../../shared/schemas/categories';
import { parseId } from '../../http/params';
import type { CompaniesService } from '../companies/service';
import type { CategoriesService } from './service';

type C = { Params: { cid: string } };
type P = { Params: { cid: string; id: string } };
const BASE = '/api/v1/companies/:cid/categories';

export function registerCategoriesRoutes(app: FastifyInstance, deps: { categories: CategoriesService; companies: CompaniesService }): void {
  const { categories } = deps;

  app.get<C>(BASE, async (req) => {
    const cid = parseId(req.params.cid);
    deps.companies.require(cid);
    return categories.listTree(cid);
  });

  app.post<C>(BASE, async (req, reply) => {
    const cid = parseId(req.params.cid);
    const body = categoryCreateSchema.parse(req.body);
    return reply.status(201).send({ category: categories.add(cid, body, req.user!.id) });
  });

  app.post<C>(`${BASE}/reorder`, async (req) => {
    const cid = parseId(req.params.cid);
    const body = categoryReorderSchema.parse(req.body);
    categories.move(cid, body, req.user!.id);
    return categories.listTree(cid);
  });

  app.patch<P>(`${BASE}/:id`, async (req) => {
    const cid = parseId(req.params.cid);
    const id = parseId(req.params.id);
    const { name } = categoryUpdateSchema.parse(req.body);
    return { category: categories.rename(cid, id, name, req.user!.id) };
  });

  app.delete<P>(`${BASE}/:id`, async (req, reply) => {
    categories.remove(parseId(req.params.cid), parseId(req.params.id), req.user!.id);
    return reply.status(204).send();
  });

  app.post<P>(`${BASE}/:id/archive`, async (req) => ({
    category: categories.archive(parseId(req.params.cid), parseId(req.params.id), req.user!.id),
  }));

  app.post<P>(`${BASE}/:id/unarchive`, async (req) => ({
    category: categories.unarchive(parseId(req.params.cid), parseId(req.params.id), req.user!.id),
  }));
}
