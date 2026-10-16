import type { FastifyInstance } from 'fastify';
import type { FastifyReply } from 'fastify';
import { cellQuerySchema, REPORT_KINDS, reportExportSchema, reportQuerySchema, statementExportSchema, statementQuerySchema } from '../../../shared/schemas/analytics';
import { contentDisposition } from '../../http/content-disposition';
import { parseId } from '../../http/params';
import { XLSX_MIME } from '../../http/xlsx';
import type { AnalyticsService } from './service';

type C = { Params: { cid: string } };
const BASE = '/api/v1/companies/:cid/analytics';

/** Файл Excel (§2.6): ссылка без побочных эффектов, как у выгрузки журнала. */
function sendXlsx(reply: FastifyReply, file: { fileName: string; data: Buffer }) {
  reply.header('Content-Type', XLSX_MIME);
  reply.header('Content-Disposition', contentDisposition(file.fileName));
  reply.header('X-Content-Type-Options', 'nosniff');
  reply.header('Cache-Control', 'private, no-store');
  return reply.send(file.data);
}

/** «Аналитика» (§9 спецификации «Аналитика»): только чтение, сессия, компания из адреса (архивная тоже читается). */
export function registerAnalyticsRoutes(app: FastifyInstance, deps: { analytics: AnalyticsService }): void {
  const { analytics } = deps;

  app.get<C>(`${BASE}/cashflow`, async (req) => analytics.cashflow(parseId(req.params.cid), reportQuerySchema.parse(req.query)));

  app.get<C>(`${BASE}/pnl`, async (req) => analytics.pnl(parseId(req.params.cid), reportQuerySchema.parse(req.query)));

  app.get<C>(`${BASE}/operations`, async (req) => analytics.operations(parseId(req.params.cid), cellQuerySchema.parse(req.query)));

  // Excel (§2.6): ссылка без побочных эффектов, как у выгрузки журнала
  for (const report of REPORT_KINDS) {
    app.get<C>(`${BASE}/${report}.xlsx`, async (req, reply) => sendXlsx(reply, analytics.exportXlsx(parseId(req.params.cid), report, reportExportSchema.parse(req.query))));
  }

  // «Выписка по счету» (§6, §9): сводка и первая страница, затем страницы курсором; Excel
  app.get<C>(`${BASE}/statement`, async (req) => analytics.statement(parseId(req.params.cid), statementQuerySchema.parse(req.query)));

  app.get<C>(`${BASE}/statement/operations`, async (req) => analytics.statementOperations(parseId(req.params.cid), statementQuerySchema.parse(req.query)));

  app.get<C>(`${BASE}/statement.xlsx`, async (req, reply) => sendXlsx(reply, analytics.statementXlsx(parseId(req.params.cid), statementExportSchema.parse(req.query))));
}
