import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';
import { loadConfig } from '../src/server/config';
import { AppError } from '../src/server/errors';
import { isValidDate, todayInTimezone } from '../src/shared/dates';
import { checkImport, formatReport } from './lib/import-check';

// Сверка импорта с файлом (§12 спецификации импорта):
//   npm run import:check -- <файл .xlsx или .csv> <id компании> [--today ГГГГ-ММ-ДД]
// id компании — число в адресе журнала: /c/<id>/log. --today — «сегодня» для разбора (строки позже — плановые и не
// считаются, как при импорте); по умолчанию — сегодня в APP_TIMEZONE. База открывается только на чтение (приложение может
// работать); файл читается тем же разборщиком, что импорт, и никуда не копируется. Выход 0 — «Совпадает», 1 — расхождения
// или ошибка.

const USAGE = 'Использование: npm run import:check -- <файл .xlsx или .csv> <id компании из адреса /c/<id>/log> [--today ГГГГ-ММ-ДД]';

function main(): number {
  const args = process.argv.slice(2);
  const at = args.indexOf('--today');
  const todayArg = at >= 0 ? args[at + 1] : undefined;
  if (at >= 0) args.splice(at, 2);
  const [file, cidArg] = args;
  const companyId = Number(cidArg);
  if (!file || !Number.isSafeInteger(companyId) || companyId <= 0 || args.length !== 2) {
    console.error(USAGE);
    return 1;
  }
  if (at >= 0 && (!todayArg || !isValidDate(todayArg))) {
    console.error(`Неверная дата --today: ${todayArg ?? '(нет)'} — нужна ГГГГ-ММ-ДД`);
    return 1;
  }
  if (!fs.existsSync(file)) {
    console.error(`Файл не найден: ${file}`);
    return 1;
  }

  if (fs.existsSync('.env')) process.loadEnvFile('.env');
  const config = loadConfig();
  if (!fs.existsSync(config.dbPath)) {
    console.error(`База не найдена: ${config.dbPath}`);
    return 1;
  }
  const sqlite = new Database(config.dbPath, { readonly: true, fileMustExist: true });
  try {
    const report = checkImport({
      sqlite,
      companyId,
      data: fs.readFileSync(file),
      fileName: path.basename(file),
      timezone: config.timezone,
      today: todayArg ?? todayInTimezone(config.timezone),
    });
    console.log(formatReport(report).join('\n'));
    return report.mismatches === 0 ? 0 : 1;
  } catch (e) {
    // ошибка файла (F*) — тем же текстом, что в панели импорта
    console.error(e instanceof AppError ? e.message : `Сверка не удалась: ${(e as Error).message}`);
    return 1;
  } finally {
    // и после ошибки: база закрывается до выхода
    sqlite.close();
  }
}

process.exitCode = main();
