import fs from 'node:fs';
import path from 'node:path';
import type { FastifyInstance } from 'fastify';
import type { Db } from '../../db/client';
import { inLine } from '../../db/tx';
import { AppError } from '../../errors';
import type { BackupService } from './service';

export function registerBackupRoutes(app: FastifyInstance, deps: { backup: BackupService; db: Db }): void {
  app.get('/api/v1/backup/download', async (req, reply) => {
    // GET с побочным эффектом: межсайтовая навигация не может выставить этот заголовок.
    if (req.headers['x-requested-with'] !== 'fetch') {
      throw new AppError(403, 'CSRF', 'Запрос отклонён защитой от подделки');
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
    const s = deps.backup.status();
    return {
      last: s.last ? { file: s.last.file, createdAt: s.last.createdAt.toISOString(), size: s.last.size } : null,
      copyDir: s.copyDir,
      lastCopyError: s.lastCopyError,
    };
  });
}
