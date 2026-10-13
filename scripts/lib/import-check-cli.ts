import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';
import { loadConfig } from '../../src/server/config';
import { AppError } from '../../src/server/errors';
import { isValidDate, todayInTimezone } from '../../src/shared/dates';
import { checkImport, formatReport, isMatch } from './import-check';

export const USAGE = 'Использование: npm run import:check -- <файл .xlsx или .csv> <id компании из адреса /c/<id>/log> [--today ГГГГ-ММ-ДД]';

export type ParsedArgs = { file: string; companyId: number; today: string | undefined } | { error: string };

/** Разбор аргументов: <файл> <id компании> и необязательное --today ГГГГ-ММ-ДД (в любом месте). */
export function parseArgs(argv: readonly string[]): ParsedArgs {
  const args = [...argv];
  const at = args.indexOf('--today');
  const todayArg = at >= 0 ? args[at + 1] : undefined;
  if (at >= 0) args.splice(at, 2);
  const [file, cidArg] = args;
  const companyId = Number(cidArg);
  if (!file || !Number.isSafeInteger(companyId) || companyId <= 0 || args.length !== 2) return { error: USAGE };
  if (at >= 0 && (!todayArg || !isValidDate(todayArg))) return { error: `Неверная дата --today: ${todayArg ?? '(нет)'} — нужна ГГГГ-ММ-ДД` };
  return { file, companyId, today: todayArg };
}

export interface CliDeps {
  log: (line: string) => void;
  error: (line: string) => void;
  /** Переменные окружения для loadConfig. */
  env?: Record<string, string | undefined>;
  /** Подхват файла настроек рядом с проектом; по умолчанию — если он есть. Вызывается внутри try. */
  loadEnvFile?: () => void;
}

const defaultLoadEnvFile = () => {
  if (fs.existsSync('.env')) process.loadEnvFile('.env');
};

/** Сверка из командной строки; возвращает код выхода: 0 — «Совпадает», 1 — расхождения, несверенное или ошибка. */
export function runImportCheck(argv: readonly string[], deps: CliDeps): number {
  const parsed = parseArgs(argv);
  if ('error' in parsed) {
    deps.error(parsed.error);
    return 1;
  }
  if (!fs.existsSync(parsed.file)) {
    deps.error(`Файл не найден: ${parsed.file}`);
    return 1;
  }
  let sqlite: InstanceType<typeof Database> | null = null;
  try {
    (deps.loadEnvFile ?? defaultLoadEnvFile)();
    const config = loadConfig(deps.env ?? process.env);
    if (!fs.existsSync(config.dbPath)) {
      deps.error(`База не найдена: ${config.dbPath}`);
      return 1;
    }
    sqlite = new Database(config.dbPath, { readonly: true, fileMustExist: true });
    const report = checkImport({
      sqlite,
      companyId: parsed.companyId,
      data: fs.readFileSync(parsed.file),
      fileName: path.basename(parsed.file),
      timezone: config.timezone,
      today: parsed.today ?? todayInTimezone(config.timezone),
    });
    deps.log(formatReport(report).join('\n'));
    return isMatch(report) ? 0 : 1;
  } catch (e) {
    // ошибка файла (F*) — тем же текстом, что в панели импорта
    deps.error(e instanceof AppError ? e.message : `Сверка не удалась: ${(e as Error).message}`);
    return 1;
  } finally {
    // и после ошибки: база закрывается до выхода
    sqlite?.close();
  }
}
