import type { FastifyInstance } from 'fastify';
import { companyCreateSchema, companyUpdateSchema } from '../../../shared/schemas/companies';
import { parseId } from '../../http/params';
import type { CompaniesService } from './service';

export function registerCompaniesRoutes(app: FastifyInstance, deps: { companies: CompaniesService }): void {
  const { companies } = deps;

  app.get('/api/v1/companies', async () => {
    const rows = [];
    for (const c of await companies.list()) rows.push({ ...c, currencyLocked: await companies.currencyLocked(c.id) });
    return { companies: rows };
  });

  app.post('/api/v1/companies', async (req, reply) => {
    const body = companyCreateSchema.parse(req.body);
    return reply.status(201).send({ company: await companies.create(body, req.user!.id) });
  });

  app.patch<{ Params: { id: string } }>('/api/v1/companies/:id', async (req) => {
    const id = parseId(req.params.id);
    await companies.require(id);
    const body = companyUpdateSchema.parse(req.body);
    return { company: await companies.update(id, body, req.user!.id) };
  });

  app.post<{ Params: { id: string } }>('/api/v1/companies/:id/archive', async (req) => ({
    company: await companies.archive(parseId(req.params.id), req.user!.id),
  }));

  app.post<{ Params: { id: string } }>('/api/v1/companies/:id/unarchive', async (req) => ({
    company: await companies.unarchive(parseId(req.params.id), req.user!.id),
  }));
}
