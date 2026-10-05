import fs from 'node:fs';
import path from 'node:path';
import type { FastifyInstance } from 'fastify';
import type { BackupService } from './service';

export function registerBackupRoutes(app: FastifyInstance, deps: { backup: BackupService }): void {
  app.get('/api/v1/backup/download', async (req, reply) => {
    const file = deps.backup.create('manual');
    reply.header('Content-Type', 'application/zip');
    reply.header('Content-Disposition', `attachment; filename="${path.basename(file)}"`);
    reply.header('X-Content-Type-Options', 'nosniff');
    return reply.send(fs.createReadStream(file));
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
