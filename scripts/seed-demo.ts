import fs from 'node:fs';
import { loadConfig } from '../src/server/config';
import { openDb } from '../src/server/db/client';
import { migrateWithBackup } from '../src/server/db/migrate';
import { seedCurrencies } from '../src/server/db/seed';
import { isLockHeld } from '../src/server/lock';
import { isValidDate } from '../src/shared/dates';
import { createBackupService } from '../src/server/modules/backup/service';
import { seedDemo } from './lib/demo';

// Демо-набор §10 для проверки и замеров: npm run seed:demo [-- <число операций, по умолчанию 10000> [<дата «сегодня» ГГГГ-ММ-ДД>]]
if (fs.existsSync('.env')) process.loadEnvFile('.env');
const config = loadConfig();
if (isLockHeld(config.lockPath)) {
  console.error('Приложение запущено — остановите его перед заливкой демо-набора.');
  process.exit(1);
}
const count = Number(process.argv[2] ?? 10_000);
if (!Number.isInteger(count) || count < 1) {
  console.error('Число операций — целое больше нуля.');
  process.exit(1);
}
// набор детерминирован для одной даты «сегодня»: явная дата повторяет его день в день
const anchor = process.argv[3];
if (anchor !== undefined && !isValidDate(anchor)) {
  console.error('Дата — в формате ГГГГ-ММ-ДД.');
  process.exit(1);
}
const now = anchor ? new Date(`${anchor}T12:00:00.000Z`) : new Date();
fs.mkdirSync(config.dataDir, { recursive: true });
fs.mkdirSync(config.backupsDir, { recursive: true });
const dbExisted = fs.existsSync(config.dbPath);
const { sqlite, db } = openDb(config.dbPath);
try {
  migrateWithBackup({
    db,
    sqlite,
    dbExisted,
    backup: createBackupService({ sqlite, config, log: (m, e) => (e ? console.error(m, e) : console.log(m)) }),
  });
  seedCurrencies(db);
  const started = Date.now();
  const r = seedDemo({ db, timezone: config.timezone, now, operations: count });
  console.log(
    `Готово за ${((Date.now() - started) / 1000).toFixed(1)} с: компаний ${r.companies}, проектов ${r.projects}, счетов ${r.accounts}, ` +
      `категорий ${r.categories}, контрагентов ${r.counterparties}, операций ${r.operations}.`,
  );
} catch (e) {
  console.error((e as Error).message);
  process.exitCode = 1;
} finally {
  sqlite.close();
}
