import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import AdmZip from 'adm-zip';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { openDb } from '../../src/server/db/client';
import { runMigrations } from '../../src/server/db/migrate';
import { createBackupService } from '../../src/server/modules/backup/service';
import { createTestApp, loginAs, seedUser, testConfig } from '../helpers/test-app';

let cleanup: (() => void) | null = null;
afterEach(() => {
  vi.restoreAllMocks();
  cleanup?.();
});

function setup(dirName = 'fc-backup-', overrides: Record<string, string> = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), dirName));
  const config = testConfig(dir, { BACKUP_KEEP: '3', ...overrides });
  fs.mkdirSync(config.dataDir, { recursive: true });
  const { sqlite, db } = openDb(config.dbPath);
  runMigrations(db);
  sqlite.prepare("INSERT INTO currencies (code, name, symbol, minor_units) VALUES ('KZT','Тенге','₸',2)").run();
  let now = new Date('2026-10-05T00:00:00.000Z');
  const clock = { advance: (ms: number) => (now = new Date(now.getTime() + ms)), now: () => now };
  const svc = createBackupService({ sqlite, config, now: clock.now });
  cleanup = () => {
    sqlite.close();
    fs.rmSync(dir, { recursive: true, force: true });
  };
  return { dir, config, sqlite, svc, clock };
}

describe('backup', () => {
  it('создаёт архив с app.db, когда uploads/ ещё нет (Review Focus 5)', () => {
    const { svc } = setup();
    const file = svc.create('manual');
    const zip = new AdmZip(file);
    expect(zip.getEntries().map((e) => e.entryName)).toEqual(['app.db']);
  });

  it('включает uploads/ и даёт согласованный снимок БД', () => {
    const { svc, config } = setup();
    fs.mkdirSync(path.join(config.uploadsDir, 'a'), { recursive: true });
    fs.writeFileSync(path.join(config.uploadsDir, 'a', 'check.pdf'), 'PDF');
    const zip = new AdmZip(svc.create('manual'));
    expect(zip.getEntry('uploads/a/check.pdf')?.getData().toString()).toBe('PDF');
    const tmp = path.join(config.dataDir, 'extract.db');
    fs.writeFileSync(tmp, zip.getEntry('app.db')!.getData());
    const { sqlite } = openDb(tmp);
    expect((sqlite.prepare('SELECT code FROM currencies').get() as { code: string }).code).toBe('KZT');
    sqlite.close();
  });

  it('работает в папке с пробелами, кириллицей и апострофом (Review Focus 3)', () => {
    const { svc } = setup("fc-backup Пользователь O'Brien ");
    expect(fs.existsSync(svc.create('manual'))).toBe(true);
  });

  it('хранит последние BACKUP_KEEP архивов и копирует в BACKUP_COPY_DIR', () => {
    const copyDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fc-copy-'));
    const { svc, clock } = setup('fc-backup-', { BACKUP_COPY_DIR: copyDir });
    for (let i = 0; i < 5; i++) {
      svc.create('daily');
      clock.advance(60_000);
    }
    expect(svc.list()).toHaveLength(3);
    expect(fs.readdirSync(copyDir).filter((f) => f.endsWith('.zip'))).toHaveLength(3);
    expect(svc.status().lastCopyError).toBeNull();
    fs.rmSync(copyDir, { recursive: true, force: true });
  });

  it('два бэкапа в одну секунду не перезаписывают друг друга', () => {
    const { svc } = setup();
    const a = svc.create('manual');
    const b = svc.create('manual');
    expect(a).not.toBe(b);
    expect(path.basename(b)).toMatch(/-2\.zip$/);
  });

  it('ensureRecent делает бэкап, только если последнему больше 24 часов', () => {
    const { svc, clock } = setup();
    expect(svc.ensureRecent()).not.toBeNull(); // бэкапов не было
    clock.advance(23 * 3600_000);
    expect(svc.ensureRecent()).toBeNull();
    clock.advance(2 * 3600_000);
    expect(svc.ensureRecent()).not.toBeNull();
  });
});

describe('backup routes', () => {
  it('скачивание требует входа и отдаёт zip', async () => {
    const t = await createTestApp();
    try {
      expect((await t.app.inject({ method: 'GET', url: '/api/v1/backup/download' })).statusCode).toBe(401);
      await seedUser(t);
      const cookie = await loginAs(t);
      const noHeader = await t.app.inject({ method: 'GET', url: '/api/v1/backup/download', headers: { cookie } });
      expect(noHeader.statusCode).toBe(403);
      expect(noHeader.json().error.code).toBe('CSRF');
      const res = await t.app.inject({ method: 'GET', url: '/api/v1/backup/download', headers: { cookie, 'x-requested-with': 'fetch' } });
      expect(res.statusCode).toBe(200);
      expect(res.headers['content-type']).toBe('application/zip');
      expect(res.headers['content-disposition']).toMatch(/attachment; filename="backup-\d{8}-\d{6}\.zip"/);
      const status = await t.app.inject({ method: 'GET', url: '/api/v1/backup/status', headers: { cookie } });
      expect(status.statusCode).toBe(200);
      expect(status.json().last).toBeNull(); // скачивание не сохраняет архив в backupsDir
    } finally {
      await t.cleanup();
    }
  });

  it('сбой удаления временной папки после скачивания не роняет сервер', async () => {
    const t = await createTestApp();
    try {
      await seedUser(t);
      const cookie = await loginAs(t);
      const eperm = () => Object.assign(new Error('EPERM: operation not permitted'), { code: 'EPERM' });
      const isExportDir = (p: fs.PathLike) => path.basename(String(p)).startsWith('fc-export-');
      const origRmSync = fs.rmSync;
      vi.spyOn(fs, 'rmSync').mockImplementation((p, o) => {
        if (isExportDir(p)) throw eperm();
        return origRmSync(p, o);
      });
      const rm = vi.spyOn(fs.promises, 'rm').mockRejectedValueOnce(eperm());
      const res = await t.app.inject({ method: 'GET', url: '/api/v1/backup/download', headers: { cookie, 'x-requested-with': 'fetch' } });
      expect(res.statusCode).toBe(200);
      await vi.waitFor(() => expect(rm).toHaveBeenCalled());
      const tmpDir = String(rm.mock.calls[0]![0]);
      expect(tmpDir).toContain('fc-export-');
      await new Promise((r) => setTimeout(r, 20));
      expect((await t.app.inject({ method: 'GET', url: '/api/v1/health' })).statusCode).toBe(200);
      vi.restoreAllMocks();
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } finally {
      await t.cleanup();
    }
  });

  it('скачивание не ротирует и не накапливает архивы и временные файлы', async () => {
    const t = await createTestApp();
    try {
      await seedUser(t);
      const cookie = await loginAs(t);
      const before = fs.existsSync(t.config.backupsDir) ? fs.readdirSync(t.config.backupsDir).length : 0;
      const tmpBefore = fs.readdirSync(os.tmpdir()).filter((f) => f.startsWith('fc-export-')).length;
      for (let i = 0; i < 20; i++) {
        const res = await t.app.inject({ method: 'GET', url: '/api/v1/backup/download', headers: { cookie, 'x-requested-with': 'fetch' } });
        expect(res.statusCode).toBe(200);
      }
      await new Promise((r) => setTimeout(r, 50));
      const after = fs.existsSync(t.config.backupsDir) ? fs.readdirSync(t.config.backupsDir).length : 0;
      expect(after).toBe(before);
      expect(fs.readdirSync(os.tmpdir()).filter((f) => f.startsWith('fc-export-')).length).toBe(tmpBefore);
    } finally {
      await t.cleanup();
    }
  });
});
