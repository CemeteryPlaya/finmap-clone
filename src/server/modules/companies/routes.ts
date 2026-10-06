import type { FastifyInstance } from 'fastify';
import { companyCreateSchema, companyUpdateSchema } from '../../../shared/schemas/companies';
import { parseId } from '../../http/params';
import type { CompaniesService } from './service';

export function registerCompaniesRoutes(app: FastifyInstance, deps: { companies: CompaniesService }): void {
  const { companies } = deps;

  app.get('/api/v1/companies', async () => ({
    companies: companies.list().map((c) => ({ ...c, currencyLocked: companies.currencyLocked(c.id) })),
  }));

  app.post('/api/v1/companies', async (req, reply) => {
    const body = companyCreateSchema.parse(req.body);
    return reply.status(201).send({ company: companies.create(body, req.user!.id) });
  });

  app.patch<{ Params: { id: string } }>('/api/v1/companies/:id', async (req) => {
    const id = parseId(req.params.id);
    companies.require(id);
    const body = companyUpdateSchema.parse(req.body);
    return { company: companies.update(id, body, req.user!.id) };
  });

  app.post<{ Params: { id: string } }>('/api/v1/companies/:id/archive', async (req) => ({
    company: companies.archive(parseId(req.params.id), req.user!.id),
  }));

  app.post<{ Params: { id: string } }>('/api/v1/companies/:id/unarchive', async (req) => ({
    company: companies.unarchive(parseId(req.params.id), req.user!.id),
  }));
}
