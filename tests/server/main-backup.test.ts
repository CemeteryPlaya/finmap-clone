import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Config } from '../../src/server/config';
import { openDb } from '../../src/server/db/client';
import { runMigrations } from '../../src/server/db/migrate';
import { startServer } from '../../src/server/main';
import { createAuditService } from '../../src/server/modules/audit/service';
import { createUsersService } from '../../src/server/modules/users/service';
import { testConfig } from '../helpers/test-app';

const flags = vi.hoisted(() => ({ failEnsureRecent: false }));

vi.mock('../../src/server/modules/backup/service', async (importOriginal) => {
  const mod = await importOriginal<typeof import('../../src/server/modules/backup/service')>();
  return {
    ...mod,
    createBackupService: (d: Parameters<typeof mod.createBackupService>[0]) => {
      const svc = mod.createBackupService(d);
      return {
        ...svc,
        ensureRecent: (maxAgeMs?: number) => {
          if (flags.failEnsureRecent) throw new Error('ENOSPC: no space left on device');
          return svc.ensureRecent(maxAgeMs);
        },
      };
    },
  };
});

let dir = '';
afterEach(() => {
  flags.failEnsureRecent = false;
  fs.rmSync(dir, { recursive: true, force: true });
});

async function seedAdmin(config: Config): Promise<void> {
  fs.mkdirSync(config.dataDir, { recursive: true });
  const { sqlite, db } = openDb(config.dbPath);
  runMigrations(db);
  await createUsersService(db, createAuditService(db)).create({ login: 'admin', name: 'A', password: 'correct-horse-1' }, null);
  sqlite.close();
}

function captureLogger() {
  const lines: Array<{ level: number; msg: string; err?: { message?: string } }> = [];
  return {
    lines,
    logger: { level: 'info', stream: { write: (s: string) => void lines.push(JSON.parse(s)) } },
  };
}

describe('startServer: общий сервис бэкапов', () => {
  it('ошибка копирования стартового бэкапа видна в /api/v1/backup/status и пишется в лог приложения', async () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fc-main-backup-'));
    const notADir = path.join(dir, 'copy-target-is-a-file');
    fs.writeFileSync(notADir, 'x');
    const config = testConfig(path.join(dir, 'data'), { PORT: '0', BACKUP_COPY_DIR: path.join(notADir, 'sub') });
    await seedAdmin(config);
    const log = captureLogger();
    const s = await startServer(config, { logger: log.logger, handleSignals: false });
    try {
      const origin = config.allowedOrigins[0]!;
      const login = await s.app.inject({
        method: 'POST',
        url: '/api/v1/auth/login',
        headers: { origin, 'x-requested-with': 'fetch' },
        payload: { login: 'admin', password: 'correct-horse-1' },
      });
      expect(login.statusCode).toBe(200);
      const cookie = `sid=${login.cookies.find((c) => c.name === 'sid')!.value}`;
      const status = await s.app.inject({ method: 'GET', url: '/api/v1/backup/status', headers: { cookie } });
      expect(status.statusCode).toBe(200);
      expect(status.json().last).not.toBeNull();
      expect(status.json().lastCopyError).toEqual(expect.any(String));
      expect(log.lines.some((l) => l.level >= 40 && /скопировать бэкап/.test(l.msg))).toBe(true);
      expect(log.lines.some((l) => /Бэкап создан \(startup\)/.test(l.msg))).toBe(true);
    } finally {
      await s.stop();
    }
  });

  it('сбой стартового бэкапа (ensureRecent) не мешает запуску: ошибка в логе, сервер слушает', async () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fc-main-backup-'));
    const config = testConfig(dir, { PORT: '0' });
    flags.failEnsureRecent = true;
    const log = captureLogger();
    const s = await startServer(config, { logger: log.logger, handleSignals: false });
    try {
      const res = await fetch(`${s.url}/api/v1/health`);
      expect(await res.json()).toEqual({ ok: true });
      const errLine = log.lines.find((l) => l.level === 50 && /ENOSPC/.test(l.err?.message ?? ''));
      expect(errLine).toBeDefined();
    } finally {
      await s.stop();
    }
  });
});
