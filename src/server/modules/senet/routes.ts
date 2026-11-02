import type { FastifyInstance } from 'fastify';
import { senetCheckSchema, senetConnectionCreateSchema, senetConnectionPatchSchema, senetCheckHistorySchema, senetOfficeSchema, senetRuleOrderSchema, senetRuleSchema, senetSyncSchema } from '../../../shared/schemas/senet';
import { parseId } from '../../http/params';
import { AppError } from '../../errors';
import type { SenetConnections } from './connections';
import type { SenetRules } from './rules-service';
import type { SenetSync } from './sync';

type C = { Params: { cid: string } };
type P = { Params: { cid: string; id: string } };
const BASE = '/api/v1/companies/:cid/senet';

/** Senet (спецификация 2026-11-02-senet-autopost): подключения и клубы. */
export function registerSenetRoutes(app: FastifyInstance, deps: { connections: SenetConnections; sync: SenetSync; rules: SenetRules }): void {
  const svc = deps.connections;

  app.get<C>(`${BASE}/connections`, async (req) => ({ connections: await svc.list(parseId(req.params.cid)) }));

  app.post<C>(`${BASE}/connections/check`, async (req) => svc.check(parseId(req.params.cid), senetCheckSchema.parse(req.body)));

  app.post<C>(`${BASE}/connections`, async (req, reply) => {
    const connection = await svc.create(parseId(req.params.cid), senetConnectionCreateSchema.parse(req.body), req.user!.id);
    return reply.status(201).send({ connection });
  });

  app.patch<P>(`${BASE}/connections/:id`, async (req) => ({
    connection: await svc.update(parseId(req.params.cid), parseId(req.params.id), senetConnectionPatchSchema.parse(req.body), req.user!.id),
  }));

  app.delete<P>(`${BASE}/connections/:id`, async (req, reply) => {
    await svc.remove(parseId(req.params.cid), parseId(req.params.id), req.user!.id);
    return reply.status(204).send();
  });

  app.post<P>(`${BASE}/connections/:id/offices`, async (req, reply) => {
    const office = await svc.createOffice(parseId(req.params.cid), parseId(req.params.id), senetOfficeSchema.parse(req.body), req.user!.id);
    return reply.status(201).send({ office });
  });

  app.patch<P>(`${BASE}/offices/:id`, async (req) => ({
    office: await svc.updateOffice(parseId(req.params.cid), parseId(req.params.id), senetOfficeSchema.parse(req.body), req.user!.id),
  }));

  // «Обновить сейчас» и «Загрузить за период»: ответ — после завершения забора
  app.post<P>(`${BASE}/connections/:id/sync`, async (req) => {
    const companyId = parseId(req.params.cid);
    const connectionId = parseId(req.params.id);
    const { from, to } = senetSyncSchema.parse(req.body ?? {});
    if (!(await svc.list(companyId)).some((c) => c.id === connectionId && !c.archivedAt)) throw new AppError(404, 'NOT_FOUND', 'Подключение Senet не найдено');
    return { runs: await deps.sync.run({ connectionId, trigger: from ? 'period' : 'manual', from, to }) };
  });

  app.get<P>(`${BASE}/sync-runs/:id`, async (req) => {
    const run = await deps.sync.getRun(parseId(req.params.cid), parseId(req.params.id));
    if (!run) throw new AppError(404, 'NOT_FOUND', 'Запуск не найден');
    return { run };
  });

  app.get<C>(`${BASE}/status`, async (req) => deps.sync.status(parseId(req.params.cid)));

  // правила разноски (§4.3, §8.1)
  app.get<C>(`${BASE}/rules`, async (req) => ({ rules: await deps.rules.list(parseId(req.params.cid)) }));
  app.post<C>(`${BASE}/rules`, async (req, reply) => reply.status(201).send({ rule: await deps.rules.create(parseId(req.params.cid), senetRuleSchema.parse(req.body), req.user!.id) }));
  app.patch<P>(`${BASE}/rules/:id`, async (req) => ({ rule: await deps.rules.update(parseId(req.params.cid), parseId(req.params.id), senetRuleSchema.parse(req.body), req.user!.id) }));
  app.delete<P>(`${BASE}/rules/:id`, async (req, reply) => {
    await deps.rules.archive(parseId(req.params.cid), parseId(req.params.id), req.user!.id);
    return reply.status(204).send();
  });
  app.put<C>(`${BASE}/rules/order`, async (req) => {
    const { type, ids } = senetRuleOrderSchema.parse(req.body);
    return { rules: await deps.rules.reorder(parseId(req.params.cid), type, ids, req.user!.id) };
  });
  app.post<C>(`${BASE}/rules/check-history`, async (req) => deps.rules.checkHistory(parseId(req.params.cid), senetCheckHistorySchema.parse(req.body)));
}
