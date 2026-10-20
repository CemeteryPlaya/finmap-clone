import { lte } from 'drizzle-orm';
import { todayInTimezone } from '../../../shared/dates';
import type { Db } from '../../db/client';
import { sessions } from '../../db/schema';
import type { FileStore } from '../../files/store';
import { dumpDatabase } from '../backup/dump';

export interface DailyDeps {
  db: Db;
  files: FileStore;
  timezone: string;
  /** Сколько последних бэкапов хранить (BACKUP_KEEP, по умолчанию 14). */
  keep: number;
  now: () => Date;
}

export interface DailyReport {
  backup: string;
  size: number;
  removed: { backups: number; uploads: number; exports: number; sessions: number };
}

const DAY_MS = 24 * 3600_000;

/** Ключ ежедневного бэкапа: дата по часам APP_TIMEZONE (второй запуск в тот же день заменяет файл). */
export const backupKey = (date: string) => `backups/${date}.json.gz`;

/**
 * Ежедневное задание режима vercel (план 2026-10-20-vercel-postgres, Р13): выгрузка базы в backups/<дата>.json.gz и
 * keep последних; файлы загрузок (uploads/) и выгрузок (exports/) старше суток; истёкшие сессии. Сбой бэкапа не
 * отменяет уборку, но задание завершается ошибкой — Vercel покажет её в журнале заданий.
 */
export async function runDaily(d: DailyDeps): Promise<DailyReport> {
  const t = d.now();
  const key = backupKey(todayInTimezone(d.timezone, t));
  let size = 0;
  let backupError: unknown = null;
  try {
    const data = await dumpDatabase(d.db, t);
    await d.files.put(key, data, 'application/gzip');
    size = data.length;
  } catch (e) {
    backupError = e;
  }

  const removed = { backups: 0, uploads: 0, exports: 0, sessions: 0 };
  if (!backupError) {
    const backups = (await d.files.list('backups/')).filter((f) => f.key.endsWith('.json.gz'));
    for (const f of backups.slice(0, Math.max(0, backups.length - d.keep))) {
      await d.files.remove(f.key);
      removed.backups++;
    }
  }
  for (const prefix of ['uploads', 'exports'] as const) {
    for (const f of await d.files.list(`${prefix}/`)) {
      if (t.getTime() - f.uploadedAt.getTime() <= DAY_MS) continue;
      await d.files.remove(f.key);
      removed[prefix]++;
    }
  }
  removed.sessions = (await d.db.delete(sessions).where(lte(sessions.expiresAt, t.toISOString())).returning({ id: sessions.id })).length;

  if (backupError) throw backupError;
  return { backup: key, size, removed };
}
