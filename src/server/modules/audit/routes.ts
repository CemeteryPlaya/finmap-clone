import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { parseId } from '../../http/params';
import type { CompaniesService } from '../companies/service';
import type { AuditService } from './service';

const auditQuery = z.object({
  limit: z.coerce.number().int().min(1, 'От 1 до 200').max(200, 'От 1 до 200').default(50),
  beforeId: z.coerce.number().int().positive().optional(),
  userId: z.coerce.number().int().positive().optional(),
  entity: z.string().regex(/^[a-z_]{1,40}$/, 'Неизвестная сущность').optional(),
});

export function registerAuditRoutes(app: FastifyInstance, deps: { audit: AuditService; companies: CompaniesService }): void {
  const page = (companyId: number | null, raw: unknown) => {
    const q = auditQuery.parse(raw);
    const entries = deps.audit.list({ companyId, ...q });
    const last = entries.at(-1);
    return { entries, nextBeforeId: entries.length === q.limit && last ? last.id : null };
  };

  app.get<{ Params: { cid: string } }>('/api/v1/companies/:cid/audit', async (req) => {
    const cid = parseId(req.params.cid);
    deps.companies.require(cid);
    return page(cid, req.query);
  });

  app.get('/api/v1/audit/system', async (req) => page(null, req.query));
}
