import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import AdmZip from 'adm-zip';
import { afterEach, describe, expect, it } from 'vitest';
import { openDb } from '../../src/server/db/client';
import { runMigrations } from '../../src/server/db/migrate';
import { createBackupService } from '../../src/server/modules/backup/service';
import { restoreBackup } from '../../src/server/modules/backup/restore';
import { testConfig } from '../helpers/test-app';

let dir = '';
afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

function prepare() {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "fc-restore O'Б "));
  const config = testConfig(dir, { PORT: '39123' });
  fs.mkdirSync(config.uploadsDir, { recursive: true });
  const { sqlite, db } = openDb(config.dbPath);
  runMigrations(db);
  sqlite.prepare("INSERT INTO users (login, name, password_hash, created_at) VALUES ('admin','A','h','2026-10-05T00:00:00.000Z')").run();
  sqlite
    .prepare("INSERT INTO sessions (token_hash, user_id, remember, created_at, expires_at, last_seen_at) VALUES ('x',1,0,'a','b','c')")
    .run();
  fs.writeFileSync(path.join(config.uploadsDir, 'old.pdf'), 'OLD');
  const archive = createBackupService({ sqlite, config }).create('manual');
  // после бэкапа данные меняются
  sqlite.prepare("UPDATE users SET name = 'Изменено'").run();
  fs.writeFileSync(path.join(config.uploadsDir, 'new.pdf'), 'NEW');
  sqlite.close();
  return { config, archive };
}

describe('restore', () => {
  it('возвращает данные и вложения из архива, очищает сессии, убирает WAL-файлы', async () => {
    const { config, archive } = prepare();
    fs.writeFileSync(config.dbPath + '-wal', 'garbage'); // остаток WAL должен уйти в pre-restore
    const { preRestoreDir } = await restoreBackup({ archivePath: archive, config });

    const { sqlite } = openDb(config.dbPath);
    expect((sqlite.prepare('SELECT name FROM users').get() as { name: string }).name).toBe('A');
    expect((sqlite.prepare('SELECT COUNT(*) n FROM sessions').get() as { n: number }).n).toBe(0);
    sqlite.close();
    expect(fs.readdirSync(config.uploadsDir)).toEqual(['old.pdf']);
    expect(fs.existsSync(path.join(preRestoreDir, 'app.db-wal'))).toBe(true);
    expect(fs.existsSync(path.join(preRestoreDir, 'uploads', 'new.pdf'))).toBe(true);
  });

  it('отказывается, если приложение запущено (lock с живым PID)', async () => {
    const { config, archive } = prepare();
    fs.writeFileSync(config.lockPath, String(process.ppid));
    await expect(restoreBackup({ archivePath: archive, config })).rejects.toThrow(/остановите приложение/i);
  });

  it('отказывается восстанавливать архив с более новой схемой', async () => {
    const { config, archive } = prepare();
    const zip = new AdmZip(archive);
    const tmp = path.join(dir, 'newer.db');
    fs.writeFileSync(tmp, zip.getEntry('app.db')!.getData());
    const { sqlite } = openDb(tmp);
    sqlite.prepare("INSERT INTO __drizzle_migrations (hash, created_at) VALUES ('future', 9999999999999)").run();
    sqlite.close();
    zip.updateFile('app.db', fs.readFileSync(tmp));
    zip.writeZip(archive);
    await expect(restoreBackup({ archivePath: archive, config })).rejects.toThrow(/новее/);
  });
});
