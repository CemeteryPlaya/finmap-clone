import type { FastifyInstance } from 'fastify';
import { accountCreateSchema, accountUpdateSchema } from '../../../shared/schemas/accounts';
import { reorderSchema } from '../../../shared/schemas/common';
import { parseId } from '../../http/params';
import type { CompaniesService } from '../companies/service';
import type { ReferencesService } from '../references/service';
import type { AccountsService } from './service';

type C = { Params: { cid: string } };
type P = { Params: { cid: string; id: string } };
const BASE = '/api/v1/companies/:cid/accounts';

export function registerAccountsRoutes(
  app: FastifyInstance,
  deps: { accounts: AccountsService; companies: CompaniesService; references: ReferencesService },
): void {
  const { accounts } = deps;

  app.get<C>(BASE, async (req) => {
    const cid = parseId(req.params.cid);
    await deps.companies.require(cid);
    // §7: валюта счёта заблокирована, если по нему есть операции (включая удалённые)
    const rows = [];
    for (const a of await accounts.list(cid)) rows.push({ ...a, hasOperations: (await deps.references.countOperations('account', a.id)) > 0 });
    return { accounts: rows };
  });

  app.post<C>(BASE, async (req, reply) => {
    const cid = parseId(req.params.cid);
    const body = accountCreateSchema.parse(req.body);
    return reply.status(201).send({ account: await accounts.add(cid, body, req.user!.id) });
  });

  app.post<C>(`${BASE}/reorder`, async (req) => {
    const cid = parseId(req.params.cid);
    const { ids } = reorderSchema.parse(req.body);
    return { accounts: await accounts.reorder(cid, ids, req.user!.id) };
  });

  app.patch<P>(`${BASE}/:id`, async (req) => {
    const cid = parseId(req.params.cid);
    const id = parseId(req.params.id);
    const body = accountUpdateSchema.parse(req.body);
    return { account: await accounts.update(cid, id, body, req.user!.id) };
  });

  app.delete<P>(`${BASE}/:id`, async (req, reply) => {
    await accounts.remove(parseId(req.params.cid), parseId(req.params.id), req.user!.id);
    return reply.status(204).send();
  });

  app.post<P>(`${BASE}/:id/archive`, async (req) => ({
    account: await accounts.archive(parseId(req.params.cid), parseId(req.params.id), req.user!.id),
  }));

  app.post<P>(`${BASE}/:id/unarchive`, async (req) => ({
    account: await accounts.unarchive(parseId(req.params.cid), parseId(req.params.id), req.user!.id),
  }));
}
