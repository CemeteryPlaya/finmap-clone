import type { FastifyInstance } from 'fastify';
import { parseId } from '../../http/params';
import type { CompaniesService } from '../companies/service';
import type { CategoriesService } from './service';

export function registerCategoriesRoutes(app: FastifyInstance, deps: { categories: CategoriesService; companies: CompaniesService }): void {
  app.get<{ Params: { cid: string } }>('/api/v1/companies/:cid/categories', async (req) => {
    const cid = parseId(req.params.cid);
    deps.companies.require(cid);
    return deps.categories.listTree(cid);
  });
}
