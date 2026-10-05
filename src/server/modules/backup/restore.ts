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

function stamp(d: Date): string {
  return d.toISOString().replace(/[-:]/g, '').replace('T', '-').slice(0, 15);
}

export async function restoreBackup(i: {
  archivePath: string;
  config: Config;
  now?: () => Date;
}): Promise<{ preRestoreDir: string }> {
  const { config } = i;
  const now = i.now ?? (() => new Date());

  if (isLockHeld(config.lockPath) || !(await isPortFree(config.host, config.port))) {
    throw new Error('Приложение запущено. Остановите приложение (и задачу автозапуска) и повторите восстановление.');
  }
  if (!fs.existsSync(i.archivePath)) throw new Error(`Файл не найден: ${i.archivePath}`);

  const zip = new AdmZip(i.archivePath);
  const dbEntry = zip.getEntry('app.db');
  if (!dbEntry) throw new Error('В архиве нет app.db — это не бэкап приложения');

  fs.mkdirSync(config.dataDir, { recursive: true });
  const staged = path.join(config.dataDir, `restore-${stamp(now())}.db`);
  fs.writeFileSync(staged, dbEntry.getData());
  {
    const { sqlite } = openDb(staged);
    const applied = appliedMigrationsCount(sqlite);
    const integrity = sqlite.pragma('integrity_check', { simple: true });
    sqlite.close();
    for (const ext of ['-wal', '-shm']) fs.rmSync(staged + ext, { force: true });
    if (applied > codeMigrationsCount()) {
      fs.rmSync(staged, { force: true });
      throw new Error('Бэкап сделан более новой версией приложения (схема новее). Обновите приложение.');
    }
    if (integrity !== 'ok') {
      fs.rmSync(staged, { force: true });
      throw new Error(`Бэкап повреждён: integrity_check = ${String(integrity)}`);
    }
  }

  const preRestoreDir = path.join(config.dataDir, `pre-restore-${stamp(now())}`);
  fs.mkdirSync(preRestoreDir, { recursive: true });
  for (const name of ['app.db', 'app.db-wal', 'app.db-shm']) {
    const p = path.join(config.dataDir, name);
    if (fs.existsSync(p)) fs.renameSync(p, path.join(preRestoreDir, name));
  }
  if (fs.existsSync(config.uploadsDir)) fs.renameSync(config.uploadsDir, path.join(preRestoreDir, 'uploads'));

  fs.renameSync(staged, config.dbPath);
  fs.mkdirSync(config.uploadsDir, { recursive: true });
  for (const entry of zip.getEntries()) {
    if (!entry.entryName.startsWith('uploads/') || entry.isDirectory) continue;
    const rel = entry.entryName.slice('uploads/'.length);
    const target = path.resolve(config.uploadsDir, rel);
    if (!target.startsWith(path.resolve(config.uploadsDir) + path.sep)) continue; // защита от ../ в архиве
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, entry.getData());
  }

  const { sqlite, db } = openDb(config.dbPath);
  runMigrations(db);
  sqlite.prepare('DELETE FROM sessions').run();
  sqlite.close();
  return { preRestoreDir };
}
