import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import AdmZip from 'adm-zip';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { openDb } from '../../src/server/db/client';
import { runMigrations } from '../../src/server/db/migrate';
import { inLine, withTx } from '../../src/server/db/tx';
import { copyErrorText, createBackupService } from '../../src/server/modules/backup/service';
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
  return { dir, config, sqlite, db, svc, clock };
}

describe('backup', () => {
  it('бэкап во время открытой транзакции ждёт её конца (VACUUM INTO внутри транзакции невозможен)', async () => {
    const { svc, db } = setup();
    let entered!: () => void;
    const inside = new Promise<void>((r) => (entered = r));
    let finish!: () => void;
    const gate = new Promise<void>((r) => (finish = r));
    const tx = withTx(db, async () => {
      entered();
      await gate;
    });
    await inside;
    const file = inLine(db, () => svc.create('manual'));
    finish();
    await tx;
    expect(fs.existsSync(await file)).toBe(true);
  });

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

  it('BACKUP_COPY_DIR нет (флешка отключена) — бэкап создан, папка не создаётся, предупреждение в журнале и статусе', () => {
    const missing = path.join(os.tmpdir(), `fc-copy-missing-${process.pid}-${Date.now()}`, 'backups');
    const { config, sqlite } = setup('fc-backup-', { BACKUP_COPY_DIR: missing });
    const logs: { msg: string; err?: unknown }[] = [];
    const svc = createBackupService({ sqlite, config, log: (msg, err) => logs.push({ msg, err }) });
    const file = svc.create('daily');
    expect(fs.existsSync(file)).toBe(true);
    expect(fs.existsSync(missing)).toBe(false);
    expect(svc.status().lastCopyError).toBe(`Папка ${missing} не найдена — подключите диск или создайте папку`);
    expect(logs.some((l) => /Не удалось скопировать бэкап/.test(l.msg) && l.err instanceof Error)).toBe(true);
  });

  it('после восстановления папки следующий бэкап копируется и ошибка сбрасывается', () => {
    const copyParent = fs.mkdtempSync(path.join(os.tmpdir(), 'fc-copy-later-'));
    const copyDir = path.join(copyParent, 'backups');
    const { svc, clock } = setup('fc-backup-', { BACKUP_COPY_DIR: copyDir });
    svc.create('daily');
    expect(svc.status().lastCopyError).not.toBeNull();
    fs.mkdirSync(copyDir);
    clock.advance(60_000);
    svc.create('daily');
    expect(svc.status().lastCopyError).toBeNull();
    expect(fs.readdirSync(copyDir).filter((f) => f.endsWith('.zip'))).toHaveLength(1);
    fs.rmSync(copyParent, { recursive: true, force: true });
  });

  it('нет прав на запись в BACKUP_COPY_DIR — бэкап создан, ошибка в статусе, сервер не падает', () => {
    const copyDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fc-copy-ro-'));
    const { svc } = setup('fc-backup-', { BACKUP_COPY_DIR: copyDir });
    vi.spyOn(fs, 'copyFileSync').mockImplementation(() => {
      throw Object.assign(new Error('EACCES: permission denied'), { code: 'EACCES' });
    });
    expect(() => svc.create('daily')).not.toThrow();
    vi.restoreAllMocks();
    expect(svc.list()).toHaveLength(1);
    expect(svc.status().lastCopyError).toBe(`Нет доступа к папке ${copyDir}`);
    fs.rmSync(copyDir, { recursive: true, force: true });
  });

  it('ротация в BACKUP_COPY_DIR не трогает чужие файлы', () => {
    const copyDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fc-copy-own-'));
    fs.writeFileSync(path.join(copyDir, 'отчёт.xlsx'), 'x');
    fs.writeFileSync(path.join(copyDir, 'backup-old.zip'), 'x');
    const { svc, clock } = setup('fc-backup-', { BACKUP_COPY_DIR: copyDir });
    for (let i = 0; i < 5; i++) {
      svc.create('daily');
      clock.advance(60_000);
    }
    const files = fs.readdirSync(copyDir);
    expect(files).toContain('отчёт.xlsx');
    expect(files).toContain('backup-old.zip');
    expect(files.filter((f) => /^backup-\d{8}-\d{6}\.zip$/.test(f))).toHaveLength(3);
    fs.rmSync(copyDir, { recursive: true, force: true });
  });

  it('два бэкапа в одну секунду не перезаписывают друг друга', () => {
    const { svc } = setup();
    const a = svc.create('manual');
    const b = svc.create('manual');
    expect(a).not.toBe(b);
    expect(path.basename(b)).toMatch(/-2\.zip$/);
  });

  it('недописанный backup-….zip.tmp не считается последним бэкапом', () => {
    const { svc, config } = setup();
    fs.mkdirSync(config.backupsDir, { recursive: true });
    fs.writeFileSync(path.join(config.backupsDir, 'backup-20261005-120000.zip.tmp'), 'partial');
    expect(svc.last()).toBeNull();
    expect(svc.list()).toEqual([]);
    expect(svc.ensureRecent()).not.toBeNull();
  });

  it('сбой при записи архива не оставляет файла с итоговым именем', () => {
    const { svc, config } = setup();
    vi.spyOn(fs, 'utimesSync').mockImplementation(() => {
      throw Object.assign(new Error('EIO: i/o error'), { code: 'EIO' });
    });
    expect(() => svc.create('manual')).toThrow(/EIO/);
    vi.restoreAllMocks();
    expect(svc.last()).toBeNull();
    expect(fs.readdirSync(config.backupsDir).filter((f) => f.startsWith('backup-'))).toEqual([]);
  });

  it('сбой копирования в BACKUP_COPY_DIR не оставляет там недописанного архива', () => {
    const copyDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fc-copy-'));
    const { svc } = setup('fc-backup-', { BACKUP_COPY_DIR: copyDir });
    vi.spyOn(fs, 'copyFileSync').mockImplementation((_src, dst) => {
      fs.writeFileSync(dst, 'partial');
      throw Object.assign(new Error('ENOSPC: no space left on device'), { code: 'ENOSPC' });
    });
    svc.create('daily');
    vi.restoreAllMocks();
    expect(svc.status().lastCopyError).toBe(`На диске с папкой ${copyDir} нет места`);
    expect(fs.readdirSync(copyDir)).toEqual([]);
    fs.rmSync(copyDir, { recursive: true, force: true });
  });

  it.each([
    ['EACCES', (dir: string) => `Нет доступа к папке ${dir}`],
    ['EPERM', (dir: string) => `Нет доступа к папке ${dir}`],
    ['ENOSPC', (dir: string) => `На диске с папкой ${dir} нет места`],
    ['EBUSY', (dir: string) => `Папка ${dir} занята другой программой`],
    ['EIO', (dir: string) => `Не удалось скопировать в ${dir} (код EIO)`],
  ])('сбой копирования %s — понятный текст с папкой, без текста системной ошибки (R3)', (code, text) => {
    const copyDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fc-copy-code-'));
    const { svc } = setup('fc-backup-', { BACKUP_COPY_DIR: copyDir });
    vi.spyOn(fs, 'copyFileSync').mockImplementation(() => {
      throw Object.assign(new Error(`${code}: C:\\Users\\Someone\\secret.tmp`), { code });
    });
    svc.create('daily');
    vi.restoreAllMocks();
    expect(svc.status().lastCopyError).toBe(text(copyDir));
    expect(svc.status().lastCopyError).not.toContain('Someone');
    fs.rmSync(copyDir, { recursive: true, force: true });
  });

  it('copyErrorText: ошибка без кода — «ошибка без кода», папка остаётся', () => {
    expect(copyErrorText('E:\\copies', undefined)).toBe('Не удалось скопировать в E:\\copies (ошибка без кода)');
    expect(copyErrorText('E:\\copies', 'ENOENT')).toBe('Папка E:\\copies не найдена — подключите диск или создайте папку');
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
      // считаем только свои временные папки: параллельные тесты других файлов тоже создают fc-export-* в общем tmpdir
      const created: string[] = [];
      const origMkdtemp = fs.mkdtempSync;
      vi.spyOn(fs, 'mkdtempSync').mockImplementation(((prefix: string, options?: BufferEncoding) => {
        const dir = origMkdtemp(prefix, options);
        if (path.basename(dir).startsWith('fc-export-')) created.push(dir);
        return dir;
      }) as typeof fs.mkdtempSync);
      for (let i = 0; i < 20; i++) {
        const res = await t.app.inject({ method: 'GET', url: '/api/v1/backup/download', headers: { cookie, 'x-requested-with': 'fetch' } });
        expect(res.statusCode).toBe(200);
      }
      vi.restoreAllMocks();
      const after = fs.existsSync(t.config.backupsDir) ? fs.readdirSync(t.config.backupsDir).length : 0;
      expect(after).toBe(before);
      expect(created).toHaveLength(20);
      await vi.waitFor(() => expect(created.filter((d) => fs.existsSync(d))).toEqual([]));
    } finally {
      await t.cleanup();
    }
  });
});
