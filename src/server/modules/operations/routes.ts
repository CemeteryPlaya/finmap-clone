import type { FastifyInstance } from 'fastify';
import { journalQuerySchema } from '../../../shared/schemas/journal';
import { operationBulkSchema, operationCreateSchema, operationUpdateSchema } from '../../../shared/schemas/operations';
import { parseId } from '../../http/params';
import type { BulkService } from './bulk';
import type { JournalService } from './journal';
import type { OperationsService } from './service';

type C = { Params: { cid: string } };
type P = { Params: { cid: string; id: string } };
const BASE = '/api/v1/companies/:cid/operations';

export function registerOperationsRoutes(
  app: FastifyInstance,
  deps: { operations: OperationsService; journal: JournalService; bulk: BulkService },
): void {
  const { operations, journal, bulk } = deps;

  // журнал: фильтр и курсор в строке запроса (§6)
  app.get<C>(BASE, async (req) => journal.list(parseId(req.params.cid), journalQuerySchema.parse(req.query)));

  app.post<C>(BASE, async (req, reply) => {
    const cid = parseId(req.params.cid);
    const body = operationCreateSchema.parse(req.body);
    return reply.status(201).send({ operation: operations.create(cid, { ...body, comment: body.comment ?? null }, req.user!.id) });
  });

  app.post<C>(`${BASE}/bulk`, async (req) => {
    const cid = parseId(req.params.cid);
    const body = operationBulkSchema.parse(req.body);
    return bulk.run(cid, body, req.user!.id);
  });

  app.get<P>(`${BASE}/:id`,async (req) => ({ operation: operations.get(parseId(req.params.cid), parseId(req.params.id)) }));

  app.patch<P>(`${BASE}/:id`, async (req) => {
    const cid = parseId(req.params.cid);
    const id = parseId(req.params.id);
    const body = operationUpdateSchema.parse(req.body);
    return { operation: operations.update(cid, id, body, req.user!.id) };
  });

  app.delete<P>(`${BASE}/:id`, async (req) => ({ operation: operations.remove(parseId(req.params.cid), parseId(req.params.id), req.user!.id) }));

  app.post<P>(`${BASE}/:id/restore`, async (req) => ({
    operation: operations.restore(parseId(req.params.cid), parseId(req.params.id), req.user!.id),
  }));
}
