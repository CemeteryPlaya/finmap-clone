import fs from 'node:fs';
import { loadConfig } from '../src/server/config';
import { openDatabase } from '../src/server/db/client';
import { migrateDatabase } from '../src/server/db/migrate';
import { restoreDatabase } from '../src/server/modules/backup/dump';
import { restoreBackup } from '../src/server/modules/backup/restore';

if (fs.existsSync('.env')) process.loadEnvFile('.env');
// Postgres (режим vercel, план 2026-10-20-vercel-postgres, Р13): выгрузка .json.gz из Vercel Blob (backups/) — в базу DATABASE_URL
if (process.argv[2] === '--pg') {
  const file = process.argv[3];
  const url = process.env.DATABASE_URL ?? '';
  if (!file || !/^postgres(ql)?:\/\//.test(url)) {
    console.error('Использование: DATABASE_URL=postgres://… npm run restore -- --pg <файл .json.gz> [--force]');
    console.error('--force — заменить данные непустой базы (без него в базу с компаниями или пользователями загрузка не идёт)');
    process.exit(1);
  }
  const opened = await openDatabase({ kind: 'neon', url });
  try {
    await migrateDatabase(opened);
    const r = await restoreDatabase(opened.db, fs.readFileSync(file), { force: process.argv.includes('--force') });
    console.log(`Восстановление завершено: таблиц ${r.tables}, строк ${r.rows}. Все пользователи войдут заново.`);
  } catch (e) {
    console.error((e as Error).message);
    process.exitCode = 1;
  } finally {
    await opened.close();
  }
  process.exit();
}

const archivePath = process.argv[2];
if (!archivePath) {
  console.error('Использование: npm run restore -- <путь к backup-*.zip>');
  process.exit(1);
}
try {
  const { preRestoreDir } = await restoreBackup({ archivePath, config: loadConfig() });
  console.log('Восстановление завершено. Все пользователи войдут заново.');
  console.log(`Прежние данные сохранены в ${preRestoreDir}`);
  console.log(
    'Запустите приложение: npm start (при автозапуске Windows — schtasks /Run /TN finmap-clone; на сервере — sudo systemctl start finmap-clone)',
  );
} catch (e) {
  console.error((e as Error).message);
  process.exit(1);
}
