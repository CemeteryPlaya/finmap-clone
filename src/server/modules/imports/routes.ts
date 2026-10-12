import type { FastifyInstance } from 'fastify';
import { importCommitSchema, importRequestSchema } from '../../../shared/schemas/imports';
import { AppError } from '../../errors';
import { contentDisposition } from '../../http/content-disposition';
import { headerFileName, parseId } from '../../http/params';
import { XLSX_MIME } from '../../http/xlsx';
import { readSessionToken } from '../auth/plugin';
import { IMPORT_MAX_BYTES } from './read-file';
import type { ImportsService } from './service';

type C = { Params: { cid: string } };
const BASE = '/api/v1/companies/:cid/imports';

export function registerImportsRoutes(app: FastifyInstance, deps: { imports: ImportsService }): void {
  const { imports } = deps;

  // отдельная область: парсер байтов и лимит 30 МБ действуют только на загрузку файла (§6.2)
  app.register(async (scope) => {
    // только байты файла: корневые парсеры JSON и текста с лимитом 30 МБ здесь не действуют — другой тип — 415
    scope.removeAllContentTypeParsers();
    scope.addContentTypeParser('application/octet-stream', { parseAs: 'buffer', bodyLimit: IMPORT_MAX_BYTES }, (_req, body, done) => done(null, body));
    // без куки сессии тело не читаем: полная проверка сеанса — как у всех маршрутов, в preHandler
    scope.addHook('onRequest', async (req) => {
      if (req.method === 'POST' && !readSessionToken(req)) throw new AppError(401, 'UNAUTHORIZED', 'Требуется вход');
    });

    scope.post<C>(`${BASE}/upload`, { bodyLimit: IMPORT_MAX_BYTES }, async (req) => {
      if (!Buffer.isBuffer(req.body)) throw new AppError(400, 'VALIDATION', 'Проверьте файл', { file: 'Нет файла' });
      return imports.upload(parseId(req.params.cid), req.user!.id, { name: headerFileName(req.headers['x-file-name']), data: req.body });
    });
  });

  app.post<C>(`${BASE}/preview`, async (req) => imports.preview(parseId(req.params.cid), req.user!.id, importRequestSchema.parse(req.body)));

  app.post<C>(BASE, async (req, reply) => {
    const companyId = parseId(req.params.cid);
    const started = performance.now();
    const result = imports.commit(companyId, req.user!.id, importCommitSchema.parse(req.body));
    // итог — без содержимого файла (§6.5)
    req.log.info(
      { companyId, userId: req.user!.id, importId: result.import.id, rows: result.counts.rows, added: result.counts.added, ms: Math.round(performance.now() - started) },
      'Импорт записан',
    );
    return reply.status(201).send(result);
  });

  app.get('/api/v1/imports/template.xlsx', async (_req, reply) => {
    const { fileName, data } = imports.template();
    reply.header('Content-Type', XLSX_MIME);
    reply.header('Content-Disposition', contentDisposition(fileName));
    reply.header('X-Content-Type-Options', 'nosniff');
    reply.header('Cache-Control', 'private, no-store');
    return reply.send(data);
  });
}
