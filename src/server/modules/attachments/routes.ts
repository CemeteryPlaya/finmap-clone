import fs from 'node:fs';
import type { FastifyInstance } from 'fastify';
import { AppError } from '../../errors';
import { parseId } from '../../http/params';
import { readSessionToken } from '../auth/plugin';
import { ATTACHMENT_MAX_BYTES, type AttachmentsService } from './service';

type P = { Params: { cid: string; id: string } };

/** Заголовок с URI-кодированным именем файла; битая кодировка — пустое имя (ошибка поля). */
function headerName(value: unknown): string {
  if (typeof value !== 'string') return '';
  try {
    return decodeURIComponent(value);
  } catch {
    return '';
  }
}

/** Content-Disposition по RFC 6266/8187: ASCII-запасное имя и полное имя в UTF-8 (кодируются и символы '()*). */
function contentDisposition(name: string): string {
  const fallback = name.replace(/[^\x20-\x7e]|["\\]/g, '_');
  const encoded = encodeURIComponent(name).replace(/['()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
  return `attachment; filename="${fallback}"; filename*=UTF-8''${encoded}`;
}

export function registerAttachmentsRoutes(app: FastifyInstance, deps: { attachments: AttachmentsService }): void {
  const { attachments } = deps;

  // отдельная область: парсер байтов и лимит 10 МБ не действуют на остальные маршруты
  app.register(async (scope) => {
    scope.addContentTypeParser('application/octet-stream', { parseAs: 'buffer', bodyLimit: ATTACHMENT_MAX_BYTES }, (_req, body, done) =>
      done(null, body),
    );
    // без куки сессии тело не читаем: полная проверка сеанса — как у всех маршрутов, в preHandler
    scope.addHook('onRequest', async (req) => {
      if (req.method === 'POST' && !readSessionToken(req)) throw new AppError(401, 'UNAUTHORIZED', 'Требуется вход');
    });

    scope.post<P>('/api/v1/companies/:cid/operations/:id/attachments', { bodyLimit: ATTACHMENT_MAX_BYTES }, async (req, reply) => {
      if (!Buffer.isBuffer(req.body)) throw new AppError(400, 'VALIDATION', 'Проверьте файл', { file: 'Нет файла' });
      const attachment = attachments.add(
        parseId(req.params.cid),
        parseId(req.params.id),
        { name: headerName(req.headers['x-file-name']), data: req.body },
        req.user!.id,
      );
      return reply.status(201).send({ attachment });
    });

    scope.get<P>('/api/v1/companies/:cid/operations/:id/attachments', async (req) => ({
      attachments: attachments.list(parseId(req.params.cid), parseId(req.params.id)),
    }));

    scope.get<P>('/api/v1/companies/:cid/attachments/:id', async (req, reply) => {
      const { row, filePath } = attachments.open(parseId(req.params.cid), parseId(req.params.id));
      if (!fs.existsSync(filePath)) throw new AppError(404, 'NOT_FOUND', 'Файл вложения не найден');
      // всегда как файл и без кэширования у посредников
      reply.header('Content-Type', 'application/octet-stream');
      reply.header('Content-Disposition', contentDisposition(row.originalName));
      reply.header('Content-Length', row.size);
      reply.header('X-Content-Type-Options', 'nosniff');
      reply.header('Cache-Control', 'private, no-store');
      return reply.send(fs.createReadStream(filePath));
    });

    scope.delete<P>('/api/v1/companies/:cid/attachments/:id', async (req, reply) => {
      attachments.remove(parseId(req.params.cid), parseId(req.params.id), req.user!.id);
      return reply.status(204).send();
    });
  });
}
