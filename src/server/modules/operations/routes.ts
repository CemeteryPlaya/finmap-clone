import type { FastifyInstance } from 'fastify';
import { operationCreateSchema } from '../../../shared/schemas/operations';
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
}
