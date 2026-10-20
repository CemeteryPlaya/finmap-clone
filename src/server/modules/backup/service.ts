import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import AdmZip from 'adm-zip';
import { AppError } from '../../errors';
import type { Config } from '../../config';
import type { Sqlite } from '../../db/client';
import { ARCHIVE_RE, archiveName } from './archive-name';

export type BackupReason = 'daily' | 'startup' | 'manual' | 'pre-migration';

export interface BackupInfo {
  file: string;
  path: string;
  createdAt: Date;
  size: number;
}

export interface BackupService {
  create(reason: BackupReason): string;
  /** Свежий архив во временной папке (fc-export-*); не ротируется и не копируется. Вызывающий удаляет dirname(path). */
  exportArchive(): string;
  list(): BackupInfo[];
  last(): BackupInfo | null;
  ensureRecent(maxAgeMs?: number): string | null;
  status(): { last: BackupInfo | null; copyDir: string | null; lastCopyError: string | null };
}

const DAY_MS = 24 * 3600_000;

/** Бэкап базы без файла SQLite (Postgres): копий на диске нет — снимки делает ежедневное задание (план 2026-10-20, Р13). */
export function unavailableBackup(): BackupService {
  const unavailable = () => new AppError(501, 'BACKUP_UNAVAILABLE', 'Резервная копия этой базы делается ежедневным заданием, а не здесь');
  return {
    create: () => {
      throw unavailable();
    },
    exportArchive: () => {
      throw unavailable();
    },
    list: () => [],
    last: () => null,
    ensureRecent: () => null,
    status: () => ({ last: null, copyDir: null, lastCopyError: null }),
  };
}

/**
 * Текст сбоя копии в BACKUP_COPY_DIR для экрана «Резервная копия» (R3 плана 1.5-4b): что сделать сотруднику,
 * с настроенной папкой; текст системной ошибки не показываем — в нём бывают другие абсолютные пути (он идёт в журнал).
 */
export function copyErrorText(dir: string, code: string | undefined): string {
  switch (code) {
    case 'ENOENT':
      return `Папка ${dir} не найдена — подключите диск или создайте папку`;
    case 'EACCES':
    case 'EPERM':
      return `Нет доступа к папке ${dir}`;
    case 'ENOSPC':
      return `На диске с папкой ${dir} нет места`;
    case 'EBUSY':
      return `Папка ${dir} занята другой программой`;
    default:
      return `Не удалось скопировать в ${dir} (${code ? `код ${code}` : 'ошибка без кода'})`;
  }
}

function listArchives(dir: string): BackupInfo[] {
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((f) => ARCHIVE_RE.test(f))
    .map((file) => {
      const p = path.join(dir, file);
      const st = fs.statSync(p);
      return { file, path: p, createdAt: st.mtime, size: st.size };
    })
    .sort((a, b) => b.file.localeCompare(a.file, 'en', { numeric: true }));
}

function isDirectory(p: string): boolean {
  try {
    return fs.statSync(p).isDirectory();
  } catch {
    return false;
  }
}

function prune(dir: string, keep: number): void {
  for (const info of listArchives(dir).slice(keep)) fs.rmSync(info.path, { force: true });
}

export function createBackupService(d: {
  sqlite: Sqlite;
  config: Config;
  now?: () => Date;
  log?: (msg: string, err?: unknown) => void;
}): BackupService {
  const { sqlite, config } = d;
  const now = d.now ?? (() => new Date());
  const log = d.log ?? (() => {});
  let lastCopyError: string | null = null;

  function uniqueTarget(base: string): string {
    let target = path.join(config.backupsDir, base);
    for (let i = 2; fs.existsSync(target); i++) target = path.join(config.backupsDir, base.replace(/\.zip$/, `-${i}.zip`));
    return target;
  }

  // Архив пишется во временный <name>.zip.tmp и переименовывается: недописанный файл
  // никогда не получает итогового имени (listArchives игнорирует .tmp).
  function buildArchive(target: string, at: Date): void {
    const tmpDb = `${target}.db.tmp`;
    const tmpZip = `${target}.tmp`;
    try {
      sqlite.prepare('VACUUM INTO ?').run(tmpDb);
      const zip = new AdmZip();
      zip.addLocalFile(tmpDb, '', 'app.db');
      if (fs.existsSync(config.uploadsDir)) zip.addLocalFolder(config.uploadsDir, 'uploads');
      zip.writeZip(tmpZip);
      fs.utimesSync(tmpZip, at, at);
      fs.renameSync(tmpZip, target);
    } finally {
      fs.rmSync(tmpDb, { force: true });
      fs.rmSync(tmpZip, { force: true });
    }
  }

  function copyAtomic(src: string, dest: string, at: Date): void {
    const tmp = `${dest}.tmp`;
    try {
      fs.copyFileSync(src, tmp);
      fs.utimesSync(tmp, at, at);
      fs.renameSync(tmp, dest);
    } finally {
      fs.rmSync(tmp, { force: true });
    }
  }

  const svc: BackupService = {
    exportArchive() {
      const at = now();
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fc-export-'));
      const target = path.join(dir, archiveName(at, config.timezone));
      try {
        buildArchive(target, at);
      } catch (e) {
        fs.rmSync(dir, { recursive: true, force: true });
        throw e;
      }
      return target;
    },
    create(reason) {
      fs.mkdirSync(config.backupsDir, { recursive: true });
      const at = now();
      const target = uniqueTarget(archiveName(at, config.timezone));
      buildArchive(target, at);
      prune(config.backupsDir, config.backupKeep);

      if (config.backupCopyDir) {
        try {
          // Папку не создаём: отключённая флешка или несмонтированный диск дали бы «успешную» копию
          // на системный диск. Нет папки — предупреждение в журнале и на экране «Резервная копия».
          if (!isDirectory(config.backupCopyDir)) {
            throw Object.assign(new Error('папка не найдена'), { code: 'ENOENT' });
          }
          copyAtomic(target, path.join(config.backupCopyDir, path.basename(target)), at);
          prune(config.backupCopyDir, config.backupKeep);
          lastCopyError = null;
        } catch (e) {
          // на экран — только настроенная папка и код ошибки: текст системной ошибки может содержать другие абсолютные пути
          lastCopyError = copyErrorText(config.backupCopyDir, (e as NodeJS.ErrnoException).code);
          log(`Не удалось скопировать бэкап в ${config.backupCopyDir}`, e);
        }
      }
      log(`Бэкап создан (${reason}): ${target}`);
      return target;
    },
    list: () => listArchives(config.backupsDir),
    last: () => listArchives(config.backupsDir)[0] ?? null,
    ensureRecent(maxAgeMs = DAY_MS) {
      const last = svc.last();
      if (last && now().getTime() - last.createdAt.getTime() < maxAgeMs) return null;
      return svc.create('startup');
    },
    status: () => ({ last: svc.last(), copyDir: config.backupCopyDir, lastCopyError }),
  };
  return svc;
}
