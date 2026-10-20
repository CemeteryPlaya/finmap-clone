import type { FastifyInstance } from 'fastify';
import { auditUndoSchema } from '../../../shared/schemas/audit';
import { journalExportPreviewSchema, journalExportSchema, journalQuerySchema } from '../../../shared/schemas/journal';
import { operationBulkSchema, operationCreateSchema, operationUpdateSchema } from '../../../shared/schemas/operations';
import { type Downloads, inlineDownloads, sendFile } from '../../http/download';
import { parseId } from '../../http/params';
import type { BulkService } from './bulk';
import type { JournalService } from './journal';
import type { OperationsService } from './service';
import type { OperationUndoService } from './undo';

type C = { Params: { cid: string } };
type P = { Params: { cid: string; id: string } };
const BASE = '/api/v1/companies/:cid/operations';

export function registerOperationsRoutes(
  app: FastifyInstance,
  deps: { operations: OperationsService; journal: JournalService; bulk: BulkService; undo: OperationUndoService; downloads?: Downloads },
): void {
  const { operations, journal, bulk, undo } = deps;
  const downloads = deps.downloads ?? inlineDownloads;

  // «Отмена» в «Истории действий» (план 2026-10-20, решение 7): каскад для окна подтверждения и сама отмена
  const UNDO = '/api/v1/companies/:cid/audit/:id/undo';
  app.get<P>(UNDO, async (req) => await undo.preview(parseId(req.params.cid), parseId(req.params.id)));
  app.post<P>(UNDO, async (req) => {
    const { ids } = auditUndoSchema.parse(req.body);
    return undo.run(parseId(req.params.cid), parseId(req.params.id), ids, req.user!.id);
  });

  // журнал: фильтр и курсор в строке запроса (§6)
  app.get<C>(BASE, async (req) => journal.list(parseId(req.params.cid), journalQuerySchema.parse(req.query)));

  // выгрузка по тому же фильтру; статические сегменты export.xlsx и export-preview важнее параметра :id
  app.get<C>(`${BASE}/export.xlsx`, async (req, reply) => {
    return sendFile(reply, await journal.exportXlsx(parseId(req.params.cid), journalExportSchema.parse(req.query)), downloads);
  });

  // превью окна «Собрать Excel» (§8.3): первые операции фильтра, текст колонок — как в файле
  app.get<C>(`${BASE}/export-preview`, async (req) => journal.exportPreview(parseId(req.params.cid), journalExportPreviewSchema.parse(req.query)));

  app.post<C>(BASE, async (req, reply) => {
    const cid = parseId(req.params.cid);
    const body = operationCreateSchema.parse(req.body);
    return reply.status(201).send({ operation: await operations.create(cid, { ...body, comment: body.comment ?? null }, req.user!.id) });
  });

  app.post<C>(`${BASE}/bulk`, async (req) => {
    const cid = parseId(req.params.cid);
    const body = operationBulkSchema.parse(req.body);
    return bulk.run(cid, body, req.user!.id);
  });

  app.get<P>(`${BASE}/:id`, async (req) => ({ operation: await operations.get(parseId(req.params.cid), parseId(req.params.id)) }));

  app.patch<P>(`${BASE}/:id`, async (req) => {
    const cid = parseId(req.params.cid);
    const id = parseId(req.params.id);
    const body = operationUpdateSchema.parse(req.body);
    return { operation: await operations.update(cid, id, body, req.user!.id) };
  });

  app.delete<P>(`${BASE}/:id`, async (req) => ({ operation: await operations.remove(parseId(req.params.cid), parseId(req.params.id), req.user!.id) }));

  app.post<P>(`${BASE}/:id/restore`, async (req) => ({
    operation: await operations.restore(parseId(req.params.cid), parseId(req.params.id), req.user!.id),
  }));
}
