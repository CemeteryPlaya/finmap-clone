import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import AdmZip from 'adm-zip';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { openDb } from '../../src/server/db/client';
import { runMigrations } from '../../src/server/db/migrate';
import { createBackupService } from '../../src/server/modules/backup/service';
import { restoreBackup } from '../../src/server/modules/backup/restore';
import { currentBootTime } from '../../src/server/lock';
import { testConfig } from '../helpers/test-app';

let dir = '';
afterEach(() => {
  vi.restoreAllMocks();
  fs.rmSync(dir, { recursive: true, force: true });
});

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
    fs.writeFileSync(config.lockPath, JSON.stringify({ pid: process.ppid, bootTime: currentBootTime() }));
    await expect(restoreBackup({ archivePath: archive, config })).rejects.toThrow(/остановите приложение/i);
  });

  it('держит lock на время восстановления и снимает его после (и после ошибки)', async () => {
    const { config, archive } = prepare();
    const seen: Array<string | null> = [];
    const origRename = fs.renameSync;
    vi.spyOn(fs, 'renameSync').mockImplementation((from, to) => {
      seen.push(fs.existsSync(config.lockPath) ? fs.readFileSync(config.lockPath, 'utf8') : null);
      return origRename(from, to);
    });
    await restoreBackup({ archivePath: archive, config });
    expect(seen.length).toBeGreaterThan(0);
    for (const content of seen) {
      expect(content).not.toBeNull();
      expect(JSON.parse(content!)).toMatchObject({ pid: process.pid });
    }
    expect(fs.existsSync(config.lockPath)).toBe(false);

    await expect(restoreBackup({ archivePath: path.join(dir, 'missing.zip'), config })).rejects.toThrow(/не найден/);
    expect(fs.existsSync(config.lockPath)).toBe(false);
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

  function rebuild(archive: string, mutate: (zip: AdmZip) => void) {
    const zip = new AdmZip(archive);
    mutate(zip);
    zip.writeZip(archive);
  }

  it('повреждённая запись uploads/ не трогает текущие данные и не оставляет временных файлов', async () => {
    const { config, archive } = prepare();
    rebuild(archive, (zip) => zip.addFile('uploads/bad.bin', Buffer.from('X'.repeat(500))));
    const buf = fs.readFileSync(archive);
    const off = new AdmZip(archive).getEntry('uploads/bad.bin')!.header.offset;
    const start = off + 30 + buf.readUInt16LE(off + 26) + buf.readUInt16LE(off + 28);
    for (let k = 0; k < 4; k++) buf[start + k] = buf[start + k]! ^ 0xff;
    fs.writeFileSync(archive, buf);

    await expect(restoreBackup({ archivePath: archive, config })).rejects.toThrow();
    const { sqlite } = openDb(config.dbPath);
    expect((sqlite.prepare('SELECT name FROM users').get() as { name: string }).name).toBe('Изменено');
    sqlite.close();
    expect(fs.readFileSync(path.join(config.uploadsDir, 'new.pdf'), 'utf8')).toBe('NEW');
    expect(fs.readdirSync(config.dataDir).filter((f) => f.startsWith('restore-') || f.startsWith('pre-restore-'))).toEqual([]);
  });

  it('app.db в архиве не SQLite: отказ без хвостов restore-*', async () => {
    const { config, archive } = prepare();
    rebuild(archive, (zip) => zip.updateFile('app.db', Buffer.from('this is not a sqlite database '.repeat(50))));
    await expect(restoreBackup({ archivePath: archive, config })).rejects.toThrow();
    expect(fs.readdirSync(config.dataDir).filter((f) => f.startsWith('restore-') || f.startsWith('pre-restore-'))).toEqual([]);
    expect(fs.existsSync(config.dbPath)).toBe(true);
  });

  it('сбой уборки временных файлов не подменяет исходную ошибку', async () => {
    const { config, archive } = prepare();
    rebuild(archive, (zip) => zip.updateFile('app.db', Buffer.from('this is not a sqlite database '.repeat(50))));
    const eperm = () => Object.assign(new Error('EPERM: operation not permitted'), { code: 'EPERM' });
    const isStaged = (p: fs.PathLike) => path.basename(String(p)).startsWith('restore-');
    const origRmSync = fs.rmSync;
    vi.spyOn(fs, 'rmSync').mockImplementation((p, o) => {
      if (isStaged(p)) throw eperm();
      return origRmSync(p, o);
    });
    const origRm = fs.promises.rm;
    vi.spyOn(fs.promises, 'rm').mockImplementation((p, o) => (isStaged(p) ? Promise.reject(eperm()) : origRm(p, o)));
    const warnings: string[] = [];
    const err = await restoreBackup({ archivePath: archive, config, warn: (m) => warnings.push(m) }).catch((e: Error) => e);
    expect(err).toBeInstanceOf(Error);
    expect((err as Error).message).not.toMatch(/EPERM/);
    expect(warnings.some((w) => /EPERM/.test(w))).toBe(true);
    expect(fs.existsSync(config.dbPath)).toBe(true);
  });

  it('запись с ../ в uploads/ пропускается (zip-slip)', async () => {
    const { config, archive } = prepare();
    rebuild(archive, (zip) => zip.addFile('uploads/AA/evil.txt', Buffer.from('EVIL')));
    const buf = fs.readFileSync(archive);
    const from = Buffer.from('uploads/AA/evil.txt');
    const to = Buffer.from('uploads/../evil.txt');
    for (let i = buf.indexOf(from); i !== -1; i = buf.indexOf(from, i + 1)) to.copy(buf, i);
    fs.writeFileSync(archive, buf);

    await restoreBackup({ archivePath: archive, config });
    expect(fs.existsSync(path.join(config.dataDir, 'evil.txt'))).toBe(false);
    expect(fs.existsSync(path.join(dir, 'evil.txt'))).toBe(false);
    expect(fs.readdirSync(config.uploadsDir)).toEqual(['old.pdf']);
  });
});
