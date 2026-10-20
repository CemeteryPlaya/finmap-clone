import fs from 'node:fs';
import path from 'node:path';
import { seedDemo } from '../../scripts/lib/demo';
import { buildApp } from '../../src/server/app';
import { openDb } from '../../src/server/db/client';
import { runMigrations } from '../../src/server/db/migrate';
import { seedCurrencies } from '../../src/server/db/seed';
import { createAuditService } from '../../src/server/modules/audit/service';
import { createUsersService } from '../../src/server/modules/users/service';
import { apiReport } from './api-report';
import { testConfig } from './test-app';

/**
 * Отдельный процесс (tsx): база SQLite с демо-набором и ответы её API в JSON — процесс привязан к одному диалекту, а тест
 * переноса работает с Postgres. Аргументы: папка данных, файл отчёта; пароль admin — в REPORT_PASSWORD (его выдаёт тест).
 */
const [dir, reportFile] = process.argv.slice(2) as [string, string];
const password = process.env.REPORT_PASSWORD;
if (!password) throw new Error('REPORT_PASSWORD не задан');
const NOW = new Date('2026-10-06T12:00:00.000Z');
const config = testConfig(dir);
fs.mkdirSync(dir, { recursive: true });
const { db, sqlite } = openDb(path.join(dir, 'app.db'));
runMigrations(db);
await seedCurrencies(db);
await createUsersService(db, createAuditService(db)).create({ login: 'admin', name: 'Админ', password }, null);
await seedDemo({ db, timezone: config.timezone, now: NOW, operations: 300 });
const app = await buildApp({ config, db, sqlite, logger: false, now: () => NOW });
await app.ready();
fs.writeFileSync(reportFile, JSON.stringify(await apiReport(app, password)));
await app.close();
sqlite.close();
