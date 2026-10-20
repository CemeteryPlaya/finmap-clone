import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import type { FastifyInstance } from 'fastify';
import type { Db } from '../../db/client';
import { inLine } from '../../db/tx';
import { AppError } from '../../errors';
import type { FileStore } from '../../files/store';
import { archiveName } from './archive-name';
import { dumpDatabase } from './dump';
import type { BackupService } from './service';

/** Режим vercel (Р13): бэкапы — выгрузки базы в хранилище (ежедневное задание), «Скачать сейчас» — свежая выгрузка по ссылке. */
export interface CloudBackups {
  files: FileStore;
  timezone: string;
  now: () => Date;
}

export function registerBackupRoutes(app: FastifyInstance, deps: { backup: BackupService; db: Db; keep: number; cloud?: CloudBackups }): void {
  const { cloud } = deps;
  app.get('/api/v1/backup/download', async (req, reply) => {
    // GET с побочным эффектом: межсайтовая навигация не может выставить этот заголовок.
    if (req.headers['x-requested-with'] !== 'fetch') {
      throw new AppError(403, 'CSRF', 'Запрос отклонён защитой от подделки');
    }
    if (cloud) {
      // выгрузка базы больше ответа функции (4,5 МБ) — в хранилище под exports/ (уборка через сутки), в ответе — ссылка
      const t = cloud.now();
      const fileName = archiveName(t, cloud.timezone).replace(/\.zip$/, '.json.gz');
      const key = `exports/${crypto.randomUUID()}/${fileName}`;
      await cloud.files.put(key, await dumpDatabase(deps.db, t), 'application/gzip');
      const url = await cloud.files.downloadUrl(key);
      if (!url) throw new AppError(500, 'INTERNAL', 'Хранилище не выдало ссылку на файл');
      reply.header('Cache-Control', 'private, no-store');
      return { url: new URL(url).href, fileName };
    }
    // VACUUM INTO внутри транзакции невозможен — архив снимается в своей очереди соединения
    const file = await inLine(deps.db, () => deps.backup.exportArchive());
    const tmpDir = path.dirname(file);
    const stream = fs.createReadStream(file);
    // Уборка — по возможности: EPERM/EBUSY (антивирус в Windows) не должен ронять сервер.
    stream.on('close', () => {
      fs.promises
        .rm(tmpDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 })
        .catch((e: unknown) => req.log.warn({ err: e }, `Не удалось удалить временную папку экспорта ${tmpDir}`));
    });
    reply.header('Content-Type', 'application/zip');
    reply.header('Content-Disposition', `attachment; filename="${path.basename(file)}"`);
    reply.header('X-Content-Type-Options', 'nosniff');
    return reply.send(stream);
  });

  app.get('/api/v1/backup/status', async () => {
    if (cloud) {
      const last = (await cloud.files.list('backups/')).filter((f) => f.key.endsWith('.json.gz')).at(-1);
      return {
        last: last ? { file: path.posix.basename(last.key), createdAt: last.uploadedAt.toISOString(), size: last.size } : null,
        copyDir: null,
        lastCopyError: null,
        storage: 'blob' as const,
        keep: deps.keep,
      };
    }
    const s = deps.backup.status();
    return {
      last: s.last ? { file: s.last.file, createdAt: s.last.createdAt.toISOString(), size: s.last.size } : null,
      copyDir: s.copyDir,
      lastCopyError: s.lastCopyError,
      storage: 'disk' as const,
      keep: deps.keep,
    };
  });
}
