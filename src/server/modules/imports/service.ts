import crypto from 'node:crypto';
import { todayInTimezone } from '../../../shared/dates';
import type { ImportCommitRequest, ImportCommitResult, ImportCounts, ImportPreview, ImportRequest } from '../../../shared/schemas/imports';
import { cleanName } from '../../../shared/text';
import type { Db } from '../../db/client';
import { AppError } from '../../errors';
import { mutate } from '../audit/mutate';
import type { AuditService } from '../audit/service';
import { requireCompany } from '../companies/guard';
import type { RatesService } from '../rates/service';
import { createImportCache, type ImportCache } from './cache';
import { writeImport, type ImportWriterDeps } from './commit';
import { parseSheet } from './parse-row';
import { buildPreview } from './preview';
import { IMPORT_MAX_BYTES, readImportFile } from './read-file';
import { buildTemplate, TEMPLATE_FILE_NAME } from './template';

/** Импорт: проверка файла и запись (§5.2, §6.2, §6.4 спецификации импорта). Отмена — план И-3. */
export interface ImportsService {
  /** Разбор файла, кэш и предпросмотр по сопоставлению счетов по умолчанию. */
  upload(companyId: number, userId: number, file: { name: string; data: Buffer }): ImportPreview;
  /** Предпросмотр по кэшу с сопоставлением счетов из запроса; токена нет — 410 IMPORT_EXPIRED. */
  preview(companyId: number, userId: number, body: ImportRequest): ImportPreview;
  /**
   * Запись одной транзакцией (§6.4): проверка заново внутри транзакции; ошибки — 422 IMPORT_INVALID, другая версия
   * проверки — 409 IMPORT_CHANGED (в обоих — свежий предпросмотр в details.preview); токена нет — 410. Успех удаляет токен.
   */
  commit(companyId: number, userId: number, body: ImportCommitRequest): ImportCommitResult;
  /** Шаблон импорта (§5.2). */
  template(): { fileName: string; data: Buffer };
}

export const importExpired = () => new AppError(410, 'IMPORT_EXPIRED', 'Проверка устарела — загрузите файл заново');
/**
 * Проверка внутри записи не даёт импортировать: ошибки (счёт ушёл в архив, справочник в архиве) или нечего добавлять —
 * все строки уже есть в компании (тот же файл записал другой пользователь). Панель показывает свежий предпросмотр.
 */
export const importInvalid = (preview: ImportPreview) => {
  const errors = preview.errors.total > 0 || preview.accounts.some((a) => a.mapping === null || a.errors.length > 0);
  const message =
    !errors && preview.counts.add === 0
      ? 'Нечего импортировать: все операции из файла уже есть в компании'
      : 'Данные компании изменились после проверки, и импорт сейчас невозможен — посмотрите ошибки в обновлённой проверке';
  return new AppError(422, 'IMPORT_INVALID', message, undefined, { preview });
};
/** Проверка внутри записи даёт другой итог, чем видел человек: панель показывает свежий и ждёт нового нажатия. */
export const importChanged = (preview: ImportPreview) =>
  new AppError(409, 'IMPORT_CHANGED', 'Данные компании изменились после проверки — посмотрите обновлённый итог и нажмите «Импортировать» ещё раз', undefined, { preview });

/** Не больше символов (кодовых точек) в имени файла предпросмотра. */
const FILE_NAME_MAX = 200;

/** Имя файла для предпросмотра: без управляющих символов (\p{Cc}); обрезка — по кодовым точкам, суррогатная пара не разрезается. */
export function importFileName(raw: string): string {
  const name = cleanName(raw).replace(/\p{Cc}/gu, '');
  return Array.from(name).slice(0, FILE_NAME_MAX).join('').trim() || 'Файл';
}

export function createImportsService(
  d: { db: Db; audit: AuditService; rates: RatesService; timezone: string; now?: () => Date; cache?: ImportCache } & ImportWriterDeps,
): ImportsService {
  const { db, timezone } = d;
  const now = d.now ?? (() => new Date());
  const cache = d.cache ?? createImportCache({ now: () => now().getTime() });
  const deps = { db, rates: d.rates, timezone, now };

  return {
    upload(companyId, userId, file) {
      // архивная компания — 422 до разбора файла
      const company = requireCompany(db, companyId, { writable: true });
      if (file.data.length > IMPORT_MAX_BYTES) throw new AppError(413, 'TOO_LARGE', 'Файл больше 30 МБ');
      const name = importFileName(file.name);
      const sheet = readImportFile(file.data, name);
      // дата 1904 — свойство листа: parseSheet берёт её из sheet.date1904
      const parsed = parseSheet(sheet, {
        timezone,
        baseCurrency: company.baseCurrency,
        today: todayInTimezone(timezone, now()),
      });
      const meta = { name, size: file.data.length, sha256: crypto.createHash('sha256').update(file.data).digest('hex') };
      const token = cache.put({ companyId, userId, file: meta, parsed });
      return buildPreview(deps, { token, companyId, file: meta, parsed }, []).preview;
    },

    preview(companyId, userId, body) {
      requireCompany(db, companyId, { writable: true });
      const entry = cache.get(body.token, companyId, userId);
      if (!entry) throw importExpired();
      return buildPreview(deps, { token: body.token, companyId, file: entry.file, parsed: entry.parsed }, body.accounts).preview;
    },

    commit(companyId, userId, body) {
      requireCompany(db, companyId, { writable: true });
      const entry = cache.get(body.token, companyId, userId);
      if (!entry) throw importExpired();
      const src = { token: body.token, companyId, file: entry.file, parsed: entry.parsed };
      // проверка заново — внутри транзакции записи: better-sqlite3 синхронна, между проверкой и записью база не меняется;
      // курсы — только чтение базы (rates.resolve), поэтому и они здесь (§6.4 п. 1–2). BEGIN IMMEDIATE: блокировка записи
      // берётся до проверки — чужая запись (скрипт, второй процесс) не вклинится между проверкой и записью (решение 17)
      const record = mutate(
        db,
        d.audit,
        (tx, audit) => {
          // компания могла уйти в архив после проверки выше (другой процесс): проверка — уже под блокировкой записи
          requireCompany(tx, companyId, { writable: true });
          const { preview, plan } = buildPreview(deps, src, body.accounts);
          if (!preview.canImport) throw importInvalid(preview);
          if (preview.revision !== body.revision) throw importChanged(preview);
          const counts: ImportCounts = {
            rows: preview.file.rows,
            income: preview.counts.income,
            expense: preview.counts.expense,
            transfer: preview.counts.transfer,
            added: plan.rows.length,
            duplicates: preview.counts.duplicates,
            skippedFuture: preview.counts.skippedFuture,
          };
          return writeImport(tx, d, { companyId, userId, at: now().toISOString(), file: entry.file, counts, plan }, audit);
        },
        { behavior: 'immediate' },
      );
      // записанный файл повторно не записывается: второй запрос с тем же токеном — 410
      cache.remove(body.token);
      return { import: record, counts: record.counts };
    },

    template() {
      return { fileName: TEMPLATE_FILE_NAME, data: buildTemplate() };
    },
  };
}
