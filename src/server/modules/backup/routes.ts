import fs from 'node:fs';
import path from 'node:path';
import type { FastifyInstance } from 'fastify';
import { AppError } from '../../errors';
import type { BackupService } from './service';

export function registerBackupRoutes(app: FastifyInstance, deps: { backup: BackupService }): void {
  app.get('/api/v1/backup/download', async (req, reply) => {
    // GET с побочным эффектом: межсайтовая навигация не может выставить этот заголовок.
    if (req.headers['x-requested-with'] !== 'fetch') {
      throw new AppError(403, 'CSRF', 'Запрос отклонён защитой от подделки');
    }
    const file = deps.backup.exportArchive();
    const tmpDir = path.dirname(file);
    const stream = fs.createReadStream(file);
    stream.on('close', () => fs.rmSync(tmpDir, { recursive: true, force: true }));
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
