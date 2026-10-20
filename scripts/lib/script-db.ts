import fs from 'node:fs';
import type { Config, DbConfig } from '../../src/server/config';
import { type Db, openDatabase, openDb } from '../../src/server/db/client';
import { migrateDatabase, migrateWithBackup } from '../../src/server/db/migrate';
import { createBackupService } from '../../src/server/modules/backup/service';

/**
 * База консольного скрипта (user:add, user:passwd): файл SQLite в DATA_DIR — с бэкапом перед миграциями, как раньше;
 * Postgres из DATABASE_URL (режим vercel, план 2026-10-20-vercel-postgres) — миграции без бэкапа: у Neon свои точки
 * восстановления, бэкапы — ежедневное задание. `override` — другая база (тесты: PGlite).
 */
export async function openScriptDb(config: Config, override?: DbConfig): Promise<{ db: Db; close(): Promise<void> }> {
  const target = override ?? config.db;
  if (target.kind !== 'sqlite') {
    const opened = await openDatabase(target);
    await migrateDatabase(opened);
    return { db: opened.db, close: () => opened.close() };
  }
  fs.mkdirSync(config.dataDir, { recursive: true });
  const dbExisted = fs.existsSync(config.dbPath);
  const { sqlite, db } = openDb(config.dbPath);
  fs.mkdirSync(config.backupsDir, { recursive: true });
  migrateWithBackup({
    db,
    sqlite,
    dbExisted,
    backup: createBackupService({ sqlite, config, log: (m, e) => (e ? console.error(m, e) : console.log(m)) }),
  });
  return {
    db,
    close: async () => {
      sqlite.close();
    },
  };
}
