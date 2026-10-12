import crypto from 'node:crypto';
import { todayInTimezone } from '../../../shared/dates';
import type { ImportPreview, ImportRequest } from '../../../shared/schemas/imports';
import { cleanName } from '../../../shared/text';
import type { Db } from '../../db/client';
import { AppError } from '../../errors';
import { requireCompany } from '../companies/guard';
import type { RatesService } from '../rates/service';
import { createImportCache, type ImportCache } from './cache';
import { parseSheet } from './parse-row';
import { buildPreview } from './preview';
import { IMPORT_MAX_BYTES, readImportFile } from './read-file';
import { buildTemplate, TEMPLATE_FILE_NAME } from './template';

/** Импорт: проверка файла без записи (§5.2, §6.2 спецификации импорта). Запись и отмена — планы И-2 и И-3. */
export interface ImportsService {
  /** Разбор файла, кэш и предпросмотр по сопоставлению счетов по умолчанию. */
  upload(companyId: number, userId: number, file: { name: string; data: Buffer }): ImportPreview;
  /** Предпросмотр по кэшу с сопоставлением счетов из запроса; токена нет — 410 IMPORT_EXPIRED. */
  preview(companyId: number, userId: number, body: ImportRequest): ImportPreview;
  /** Шаблон импорта (§5.2). */
  template(): { fileName: string; data: Buffer };
}

export const importExpired = () => new AppError(410, 'IMPORT_EXPIRED', 'Проверка устарела — загрузите файл заново');

/** Не больше символов (кодовых точек) в имени файла предпросмотра. */
const FILE_NAME_MAX = 200;

/** Имя файла для предпросмотра: без управляющих символов (\p{Cc}); обрезка — по кодовым точкам, суррогатная пара не разрезается. */
export function importFileName(raw: string): string {
  const name = cleanName(raw).replace(/\p{Cc}/gu, '');
  return Array.from(name).slice(0, FILE_NAME_MAX).join('').trim() || 'Файл';
}

export function createImportsService(d: { db: Db; rates: RatesService; timezone: string; now?: () => Date; cache?: ImportCache }): ImportsService {
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

    template() {
      return { fileName: TEMPLATE_FILE_NAME, data: buildTemplate() };
    },
  };
}
