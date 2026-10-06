import type { FastifyInstance } from 'fastify';
import { operationCreateSchema, operationUpdateSchema } from '../../../shared/schemas/operations';
import { parseId } from '../../http/params';
import type { OperationsService } from './service';

type C = { Params: { cid: string } };
type P = { Params: { cid: string; id: string } };
const BASE = '/api/v1/companies/:cid/operations';

export function registerOperationsRoutes(app: FastifyInstance, deps: { operations: OperationsService }): void {
  const { operations } = deps;

  app.post<C>(BASE, async (req, reply) => {
    const cid = parseId(req.params.cid);
    const body = operationCreateSchema.parse(req.body);
    return reply.status(201).send({ operation: operations.create(cid, { ...body, comment: body.comment ?? null }, req.user!.id) });
  });

  app.get<P>(`${BASE}/:id`, async (req) => ({ operation: operations.get(parseId(req.params.cid), parseId(req.params.id)) }));

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
