import fs from 'node:fs';
import { loadConfig } from '../src/server/config';
import { restoreBackup } from '../src/server/modules/backup/restore';

if (fs.existsSync('.env')) process.loadEnvFile('.env');
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
