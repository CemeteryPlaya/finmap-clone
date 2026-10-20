import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { openScriptDb } from '../../scripts/lib/script-db';
import { createAuditService } from '../../src/server/modules/audit/service';
import { createUsersService } from '../../src/server/modules/users/service';
import { onPg } from '../helpers/test-db';
import { testConfig } from '../helpers/test-app';

/**
 * База консольных скриптов (user:add, user:passwd; план 2026-10-20-vercel-postgres, задача 18): файл SQLite в DATA_DIR —
 * с бэкапом перед миграциями, как раньше; Postgres из DATABASE_URL — миграции без бэкапа (у Neon — свои точки восстановления).
 */

let dir = '';
afterEach(() => {
  if (dir) fs.rmSync(dir, { recursive: true, force: true });
  dir = '';
});

describe('openScriptDb', () => {
  it('размеченная база, в которую пишет сервис пользователей; закрывается', async () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fc-script-db-'));
    const config = testConfig(dir);
    // на Postgres — PGlite вместо адреса Neon (тот же код открытия и миграций)
    const s = await openScriptDb(config, onPg ? { kind: 'pglite' } : undefined);
    try {
      const u = await createUsersService(s.db, createAuditService(s.db)).create({ login: 'owner', name: 'Владелец', password: 'long-password-1' }, null);
      expect(u.login).toBe('owner');
      expect(fs.existsSync(config.dbPath)).toBe(!onPg); // Postgres — не файл в DATA_DIR
    } finally {
      await s.close();
    }
  });
});
