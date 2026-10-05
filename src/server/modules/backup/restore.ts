import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import AdmZip from 'adm-zip';
import type { Config } from '../../config';
import { openDb } from '../../db/client';
import { appliedMigrationsCount, codeMigrationsCount, runMigrations } from '../../db/migrate';
import { isLockHeld } from '../../lock';

function isPortFree(host: string, port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const srv = net.createServer();
    srv.once('error', () => resolve(false));
    srv.once('listening', () => srv.close(() => resolve(true)));
    srv.listen(port, host);
  });
}

async function bestEffortRm(p: string, warn: (msg: string) => void): Promise<void> {
  try {
    await fs.promises.rm(p, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  } catch (e) {
    warn(`Не удалось удалить временный путь ${p}: ${(e as Error).message}`);
  }
}

function stamp(d: Date): string {
  return d.toISOString().replace(/[-:]/g, '').replace('T', '-').slice(0, 15);
}

export async function restoreBackup(i: {
  archivePath: string;
  config: Config;
  now?: () => Date;
  warn?: (msg: string) => void;
}): Promise<{ preRestoreDir: string }> {
  const { config } = i;
  const now = i.now ?? (() => new Date());
  const warn = i.warn ?? ((m: string) => console.warn(m));

  if (isLockHeld(config.lockPath) || !(await isPortFree(config.host, config.port))) {
    throw new Error('Приложение запущено. Остановите приложение (и задачу автозапуска) и повторите восстановление.');
  }
  if (!fs.existsSync(i.archivePath)) throw new Error(`Файл не найден: ${i.archivePath}`);

  const zip = new AdmZip(i.archivePath);
  const dbEntry = zip.getEntry('app.db');
  if (!dbEntry) throw new Error('В архиве нет app.db — это не бэкап приложения');

  fs.mkdirSync(config.dataDir, { recursive: true });
  const tag = stamp(now());
  const staged = path.join(config.dataDir, `restore-${tag}.db`);
  const stagedUploads = path.join(config.dataDir, `restore-${tag}-uploads`);
  const preRestoreDir = path.join(config.dataDir, `pre-restore-${tag}`);
  const moved: Array<{ from: string; to: string }> = [];
  const move = (from: string, to: string) => {
    fs.renameSync(from, to);
    moved.push({ from, to });
  };

  try {
    // 1. Вся работа, которая может упасть, выполняется до изменения текущих данных.
    fs.writeFileSync(staged, dbEntry.getData());
    const { sqlite, db } = openDb(staged);
    try {
      if (appliedMigrationsCount(sqlite) > codeMigrationsCount()) {
        throw new Error('Бэкап сделан более новой версией приложения (схема новее). Обновите приложение.');
      }
      const integrity = sqlite.pragma('integrity_check', { simple: true });
      if (integrity !== 'ok') throw new Error(`Бэкап повреждён: integrity_check = ${String(integrity)}`);
      runMigrations(db);
      sqlite.prepare('DELETE FROM sessions').run();
    } finally {
      sqlite.close();
    }
    for (const ext of ['-wal', '-shm']) fs.rmSync(staged + ext, { force: true });

    fs.mkdirSync(stagedUploads, { recursive: true });
    const stagedRoot = path.resolve(stagedUploads);
    for (const entry of zip.getEntries()) {
      if (!entry.entryName.startsWith('uploads/') || entry.isDirectory) continue;
      const data = entry.getData(); // бросает при повреждённой записи (CRC)
      const target = path.resolve(stagedRoot, entry.entryName.slice('uploads/'.length));
      if (!target.startsWith(stagedRoot + path.sep)) continue; // защита от ../ в архиве
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.writeFileSync(target, data);
    }

    // 2. Подмена: текущие данные уходят в pre-restore, подготовленные встают на место.
    try {
      fs.mkdirSync(preRestoreDir, { recursive: true });
      for (const name of ['app.db', 'app.db-wal', 'app.db-shm']) {
        const p = path.join(config.dataDir, name);
        if (fs.existsSync(p)) move(p, path.join(preRestoreDir, name));
      }
      if (fs.existsSync(config.uploadsDir)) move(config.uploadsDir, path.join(preRestoreDir, 'uploads'));
      move(staged, config.dbPath);
      move(stagedUploads, config.uploadsDir);
    } catch (e) {
      for (const m of moved.reverse()) {
        try {
          fs.renameSync(m.to, m.from);
        } catch {
          /* best effort */
        }
      }
      throw new Error(
        `Восстановление прервано: ${(e as Error).message}. Прежние данные: ${preRestoreDir}. ` +
          'Не запускайте приложение, пока проблема не устранена.',
      );
    }
  } finally {
    // Уборка — по возможности: её сбой не должен подменять исходную ошибку или ошибку отката.
    for (const p of [staged, staged + '-wal', staged + '-shm', stagedUploads]) await bestEffortRm(p, warn);
  }
  return { preRestoreDir };
}
