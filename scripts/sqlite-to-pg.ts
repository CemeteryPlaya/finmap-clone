import path from 'node:path';
import { parseArgs } from 'node:util';
import { openDatabase } from '../src/server/db/client';
import { migrateDatabase } from '../src/server/db/migrate';
import { createBlobStore } from '../src/server/files/blob';
import { copyUploads, transferSqliteToPg } from './lib/sqlite-to-pg';

// Перенос базы SQLite в Postgres (Neon) перед запуском на Vercel (план 2026-10-20-vercel-postgres, задача 17):
//   npm run db:to-pg -- --from <копия data/app.db> --to <postgres://…> [--files] [--force]
// 1) миграции цели; 2) все таблицы одной транзакцией в порядке внешних ключей; 3) счётчики id; 4) --files — вложения из
// папки uploads рядом с файлом базы в Vercel Blob (BLOB_READ_WRITE_TOKEN) с теми же ключами; 5) сверка в stdout.
// Цель должна быть пустой (свежая ветка Neon): иначе отказ без записи; --force заменяет все её данные.
// Исходный файл открывается только на чтение — переносите копию, пока приложение работает с оригиналом.

const { values } = parseArgs({ options: { from: { type: 'string' }, to: { type: 'string' }, files: { type: 'boolean' }, force: { type: 'boolean' } } });
if (!values.from || !values.to || !/^postgres(ql)?:\/\//.test(values.to)) {
  console.error('Использование: npm run db:to-pg -- --from <файл .db> --to <postgres://…> [--files] [--force]');
  process.exit(1);
}
if (values.files && !process.env.BLOB_READ_WRITE_TOKEN) {
  console.error('--files: нужен BLOB_READ_WRITE_TOKEN хранилища Vercel Blob проекта (npx vercel env pull)');
  process.exit(1);
}

const target = await openDatabase({ kind: 'neon', url: values.to });
try {
  await migrateDatabase(target);
  const report = await transferSqliteToPg(values.from, target, { force: values.force });
  console.log('Таблица'.padEnd(28), 'SQLite'.padStart(9), 'Postgres'.padStart(9));
  for (const t of report.tables) console.log(t.name.padEnd(28), String(t.source).padStart(9), String(t.target).padStart(9), t.source === t.target ? '' : '  РАСХОЖДЕНИЕ');
  console.log(`Сумма операций (amount):      ${report.sums.amount[0]} → ${report.sums.amount[1]}`);
  console.log(`Сумма в базовой валюте:        ${report.sums.baseAmount[0]} → ${report.sums.baseAmount[1]}`);
  if (values.files) {
    const uploads = path.join(path.dirname(path.resolve(values.from)), 'uploads');
    const copied = await copyUploads(uploads, createBlobStore(process.env.BLOB_READ_WRITE_TOKEN!));
    console.log(`Вложения: ${copied.files} файлов, ${(copied.bytes / 1024 / 1024).toFixed(1)} МБ — из ${uploads} в Vercel Blob`);
  }
  console.log(report.ok ? '\nИтог: перенос сверен — совпадает' : '\nИтог: РАСХОЖДЕНИЕ — проверьте таблицы выше');
  process.exitCode = report.ok ? 0 : 1;
} catch (e) {
  console.error((e as Error).message);
  process.exitCode = 1;
} finally {
  await target.close();
}
