import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { openDb } from '../../src/server/db/client';
import { runMigrations } from '../../src/server/db/migrate';

export function createTestDb() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fc-test-'));
  const { sqlite, db } = openDb(path.join(dir, 'app.db'));
  runMigrations(db);
  return {
    sqlite,
    db,
    dir,
    cleanup() {
      sqlite.close();
      fs.rmSync(dir, { recursive: true, force: true });
    },
  };
}
