import { EXPORT_COLUMNS_DEFAULT, isExportColumnId, type ExportColumnId } from '../../shared/export-columns';

/**
 * Набор колонок окна «Собрать Excel» (§8.3 спецификации импорта): чистые функции, тесты — в node без DOM.
 */

/** Ключ настройки пользователя (`user_preferences`): массив id колонок в порядке файла. */
export const EXPORT_COLUMNS_PREF = 'export.columns';

/**
 * Набор из сохранённой настройки: неизвестные id и повторы отбрасываются, порядок сохраняется. Нет настройки, она не
 * массив или после отбрасывания пуста — набор по умолчанию (все колонки Finmap).
 */
export function savedExportColumns(pref: unknown): ExportColumnId[] {
  if (!Array.isArray(pref)) return [...EXPORT_COLUMNS_DEFAULT];
  const columns: ExportColumnId[] = [];
  for (const x of pref) if (isExportColumnId(x) && !columns.includes(x)) columns.push(x);
  return columns.length > 0 ? columns : [...EXPORT_COLUMNS_DEFAULT];
}

/** Чип: включённая колонка добавляется в конец, выключенная убирается; порядок остальных не меняется. */
export function toggleExportColumn(columns: readonly ExportColumnId[], id: ExportColumnId): ExportColumnId[] {
  return columns.includes(id) ? columns.filter((c) => c !== id) : [...columns, id];
}
