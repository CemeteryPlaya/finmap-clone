import type { FastifyInstance, FastifyReply } from 'fastify';
import { isIndicatorPart, type IndicatorPart } from '../../../shared/report-indicators';
import {
  cellQuerySchema,
  indicatorPartSchema,
  indicatorsQuerySchema,
  projectsQuerySchema,
  REPORT_KINDS,
  reportExportSchema,
  reportQuerySchema,
  statementExportSchema,
  statementQuerySchema,
} from '../../../shared/schemas/analytics';
import { AppError } from '../../errors';
import { contentDisposition } from '../../http/content-disposition';
import { parseId } from '../../http/params';
import { XLSX_MIME } from '../../http/xlsx';
import type { AnalyticsService } from './service';

type C = { Params: { cid: string } };
type P = { Params: { cid: string; part: string } };
const BASE = '/api/v1/companies/:cid/analytics';

/** Файл Excel (§2.6): ссылка без побочных эффектов, как у выгрузки журнала. */
function sendXlsx(reply: FastifyReply, file: { fileName: string; data: Buffer }) {
  reply.header('Content-Type', XLSX_MIME);
  reply.header('Content-Disposition', contentDisposition(file.fileName));
  reply.header('X-Content-Type-Options', 'nosniff');
  reply.header('Cache-Control', 'private, no-store');
  return reply.send(file.data);
}

/** Часть показателя из адреса (§8.2): revenue, cogs, variable или operating; иначе 404. */
function partParam(raw: string): IndicatorPart {
  if (!isIndicatorPart(raw)) throw new AppError(404, 'NOT_FOUND', 'Часть показателя не найдена');
  return raw;
}

/**
 * «Аналитика» (§9 спецификации «Аналитика»): отчёты только читают — сессия, компания из адреса (архивная тоже читается).
 * Изменение — только настройка частей «Финансовых показателей» (§8.2): CSRF, архивная компания — только чтение.
 */
export function registerAnalyticsRoutes(app: FastifyInstance, deps: { analytics: AnalyticsService }): void {
  const { analytics } = deps;

  app.get<C>(`${BASE}/cashflow`, async (req) => analytics.cashflow(parseId(req.params.cid), reportQuerySchema.parse(req.query)));

  app.get<C>(`${BASE}/pnl`, async (req) => analytics.pnl(parseId(req.params.cid), reportQuerySchema.parse(req.query)));

  app.get<C>(`${BASE}/projects`, async (req) => analytics.projects(parseId(req.params.cid), projectsQuerySchema.parse(req.query)));

  app.get<C>(`${BASE}/operations`, async (req) => analytics.operations(parseId(req.params.cid), cellQuerySchema.parse(req.query)));

  // Excel (§2.6): ссылка без побочных эффектов, как у выгрузки журнала
  for (const report of REPORT_KINDS) {
    app.get<C>(`${BASE}/${report}.xlsx`, async (req, reply) => sendXlsx(reply, await analytics.exportXlsx(parseId(req.params.cid), report, reportExportSchema.parse(req.query))));
  }

  app.get<C>(`${BASE}/projects.xlsx`, async (req, reply) => sendXlsx(reply, await analytics.projectsXlsx(parseId(req.params.cid), projectsQuerySchema.parse(req.query))));

  // «Финансовые показатели» (§8, §9): таблица, Excel, настройка частей и «Вернуть по умолчанию»
  app.get<C>(`${BASE}/indicators`, async (req) => analytics.indicators(parseId(req.params.cid), indicatorsQuerySchema.parse(req.query)));

  app.get<C>(`${BASE}/indicators.xlsx`, async (req, reply) => sendXlsx(reply, await analytics.indicatorsXlsx(parseId(req.params.cid), indicatorsQuerySchema.parse(req.query))));

  app.put<P>(`${BASE}/indicators/parts/:part`, async (req) => ({
    parts: await analytics.savePart(parseId(req.params.cid), partParam(req.params.part), indicatorPartSchema.parse(req.body), req.user!.id),
  }));

  app.delete<P>(`${BASE}/indicators/parts/:part`, async (req) => ({ parts: await analytics.resetPart(parseId(req.params.cid), partParam(req.params.part), req.user!.id) }));

  // «Выписка по счету» (§6, §9): сводка и первая страница, затем страницы курсором; Excel
  app.get<C>(`${BASE}/statement`, async (req) => analytics.statement(parseId(req.params.cid), statementQuerySchema.parse(req.query)));

  app.get<C>(`${BASE}/statement/operations`, async (req) => analytics.statementOperations(parseId(req.params.cid), statementQuerySchema.parse(req.query)));

  app.get<C>(`${BASE}/statement.xlsx`, async (req, reply) => sendXlsx(reply, await analytics.statementXlsx(parseId(req.params.cid), statementExportSchema.parse(req.query))));
}
