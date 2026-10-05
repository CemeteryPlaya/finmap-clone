import fs from 'node:fs';
import path from 'node:path';
import AdmZip from 'adm-zip';
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
  list(): BackupInfo[];
  last(): BackupInfo | null;
  ensureRecent(maxAgeMs?: number): string | null;
  status(): { last: BackupInfo | null; copyDir: string | null; lastCopyError: string | null };
}

const DAY_MS = 24 * 3600_000;

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

  const svc: BackupService = {
    create(reason) {
      fs.mkdirSync(config.backupsDir, { recursive: true });
      const at = now();
      const target = uniqueTarget(archiveName(at, config.timezone));
      const tmpDb = `${target}.db.tmp`;
      try {
        sqlite.prepare('VACUUM INTO ?').run(tmpDb);
        const zip = new AdmZip();
        zip.addLocalFile(tmpDb, '', 'app.db');
        if (fs.existsSync(config.uploadsDir)) zip.addLocalFolder(config.uploadsDir, 'uploads');
        zip.writeZip(target);
        fs.utimesSync(target, at, at);
      } finally {
        fs.rmSync(tmpDb, { force: true });
      }
      prune(config.backupsDir, config.backupKeep);

      if (config.backupCopyDir) {
        try {
          fs.mkdirSync(config.backupCopyDir, { recursive: true });
          const copy = path.join(config.backupCopyDir, path.basename(target));
          fs.copyFileSync(target, copy);
          fs.utimesSync(copy, at, at);
          prune(config.backupCopyDir, config.backupKeep);
          lastCopyError = null;
        } catch (e) {
          lastCopyError = (e as Error).message;
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
