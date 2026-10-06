import type { FastifyInstance } from 'fastify';
import { parseId } from '../../http/params';
import type { CompaniesService } from '../companies/service';
import type { AccountsService } from './service';

export function registerAccountsRoutes(app: FastifyInstance, deps: { accounts: AccountsService; companies: CompaniesService }): void {
  app.get<{ Params: { cid: string } }>('/api/v1/companies/:cid/accounts', async (req) => {
    const cid = parseId(req.params.cid);
    deps.companies.require(cid);
    return { accounts: deps.accounts.list(cid) };
  });
}
