import type { FastifyInstance } from 'fastify';
import { storedFileSchema } from '../../../shared/schemas/uploads';
import { AppError } from '../../errors';
import type { FileStore } from '../../files/store';
import { contentDisposition } from '../../http/content-disposition';
import { headerFileName, parseId } from '../../http/params';
import { readSessionToken } from '../auth/plugin';
import { ATTACHMENT_MAX_BYTES, type AttachmentsService } from './service';

type P = { Params: { cid: string; id: string } };

/** `stored` — браузер грузит файлы прямо в хранилище (режим vercel): POST вложения принимает и JSON с ключом файла. */
export function registerAttachmentsRoutes(app: FastifyInstance, deps: { attachments: AttachmentsService; files: FileStore; stored: boolean }): void {
  const { attachments, files } = deps;

  // отдельная область: парсер байтов и лимит 10 МБ не действуют на остальные маршруты
  app.register(async (scope) => {
    // только байты файла: корневые парсеры JSON и текста здесь не действуют (иначе читали бы до 10 МБ) — другой тип — 415
    scope.removeAllContentTypeParsers();
    scope.addContentTypeParser('application/octet-stream', { parseAs: 'buffer', bodyLimit: ATTACHMENT_MAX_BYTES }, (_req, body, done) =>
      done(null, body),
    );
    // режим vercel (Р11): файл уже в хранилище — в теле только его ключ и имя; локально JSON здесь — 415, как раньше
    if (deps.stored) scope.addContentTypeParser('application/json', { parseAs: 'string', bodyLimit: 4096 }, (_req, body, done) => {
      try {
        done(null, JSON.parse(body as string));
      } catch {
        done(new AppError(400, 'VALIDATION', 'Неверный JSON'), undefined);
      }
    });
    // без куки сессии тело не читаем: полная проверка сеанса — как у всех маршрутов, в preHandler
    scope.addHook('onRequest', async (req) => {
      if (req.method === 'POST' && !readSessionToken(req)) throw new AppError(401, 'UNAUTHORIZED', 'Требуется вход');
    });

    scope.post<P>('/api/v1/companies/:cid/operations/:id/attachments', { bodyLimit: ATTACHMENT_MAX_BYTES }, async (req, reply) => {
      if (!Buffer.isBuffer(req.body)) {
        const parsed = storedFileSchema.safeParse(req.body);
        if (!parsed.success) throw new AppError(400, 'VALIDATION', 'Проверьте файл', { file: 'Нет файла' });
        const attachment = await attachments.addStored(
          parseId(req.params.cid),
          parseId(req.params.id),
          { key: parsed.data.blobKey, name: parsed.data.fileName },
          req.user!.id,
        );
        return reply.status(201).send({ attachment });
      }
      const attachment = await attachments.add(
        parseId(req.params.cid),
        parseId(req.params.id),
        { name: headerFileName(req.headers['x-file-name']), data: req.body },
        req.user!.id,
      );
      return reply.status(201).send({ attachment });
    });

    scope.get<P>('/api/v1/companies/:cid/operations/:id/attachments', async (req) => ({
      attachments: await attachments.list(parseId(req.params.cid), parseId(req.params.id)),
    }));

    scope.get<P>('/api/v1/companies/:cid/attachments/:id', async (req, reply) => {
      const row = await attachments.open(parseId(req.params.cid), parseId(req.params.id));
      reply.header('Cache-Control', 'private, no-store');
      // Vercel Blob: подписанная ссылка на 5 минут — ответ функции Vercel не больше 4,5 МБ, а вложение — до 10 МБ
      const link = await files.downloadUrl(row.storedName);
      if (link) return reply.redirect(new URL(link).href, 302);
      const data = await files.get(row.storedName);
      if (!data) throw new AppError(404, 'NOT_FOUND', 'Файл вложения не найден');
      // всегда как файл и без кэширования у посредников
      reply.header('Content-Type', 'application/octet-stream');
      reply.header('Content-Disposition', contentDisposition(row.originalName));
      reply.header('Content-Length', row.size);
      reply.header('X-Content-Type-Options', 'nosniff');
      return reply.send(data);
    });

    scope.delete<P>('/api/v1/companies/:cid/attachments/:id', async (req, reply) => {
      await attachments.remove(parseId(req.params.cid), parseId(req.params.id), req.user!.id);
      return reply.status(204).send();
    });
  });
}
