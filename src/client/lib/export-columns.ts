import { EXPORT_COLUMNS_DEFAULT, exportColumnLabel, isExportColumnId, type ExportColumnId } from '../../shared/export-columns';

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

/** Alt+← / Alt+→ на ручке заголовка: колонка встаёт на соседнее место; на краю и не из набора — null. */
export function shiftExportColumn(columns: readonly ExportColumnId[], id: ExportColumnId, delta: -1 | 1): ExportColumnId[] | null {
  const i = columns.indexOf(id);
  const j = i + delta;
  if (i < 0 || j < 0 || j >= columns.length) return null;
  const next = [...columns];
  [next[i], next[j]] = [next[j]!, next[i]!];
  return next;
}

/**
 * Колонку id отпустили на место index среди остальных колонок (0 — первой, длина остальных — последней): новый порядок;
 * то же место и колонка не из набора — null.
 */
export function dropExportColumn(columns: readonly ExportColumnId[], id: ExportColumnId, index: number): ExportColumnId[] | null {
  if (!columns.includes(id)) return null;
  const others = columns.filter((c) => c !== id);
  const at = Math.max(0, Math.min(index, others.length));
  const next = [...others.slice(0, at), id, ...others.slice(at)];
  return next.every((c, i) => c === columns[i]) ? null : next;
}

/** Объявление после перестановки: «Сумма в валюте счета — колонка 3 из 12». */
export function columnPositionText(columns: readonly ExportColumnId[], id: ExportColumnId): string {
  return `${exportColumnLabel(id)} — колонка ${columns.indexOf(id) + 1} из ${columns.length}`;
}

/** Объявление после «×»: «Колонка «Тип» убрана. Осталось колонок: 5». */
export function columnRemovedText(id: ExportColumnId, left: number): string {
  return `Колонка «${exportColumnLabel(id)}» убрана. Осталось колонок: ${left}`;
}

/** Куда перевести фокус после «×»: номер заголовка среди оставшихся (ближайший к убранному); null — колонок не осталось. */
export function focusIndexAfterRemove(columns: readonly ExportColumnId[], id: ExportColumnId): number | null {
  const left = columns.length - 1;
  const i = columns.indexOf(id);
  return left <= 0 || i < 0 ? null : Math.min(i, left - 1);
}
