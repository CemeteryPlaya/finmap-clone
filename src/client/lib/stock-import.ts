import { formatMoney, MONEY_SCREEN } from '../../shared/money';
import type { StockImportKind, StockImportResult } from '../../shared/schemas/stock';

/** «Сок, Жвачка» и «и ещё N», если названий больше, чем пришло в ответе. */
function namesText(names: readonly string[], total: number): string {
  const rest = total - names.length;
  return `${names.join(', ')}${rest > 0 ? ` и ещё ${rest}` : ''}`;
}

/** Строки итога проверки импорта склада (§9.1): что в файле и что будет создано — опечатки видны по названиям. */
export function importSummary(r: StockImportResult, kind: StockImportKind, currency: string): string[] {
  const lines = [`Строк в файле: ${r.rows}`];
  if (kind === 'receipts') lines.push(`Документов: ${r.docs}, строк: ${r.lines}, на сумму ${formatMoney(r.total, currency, MONEY_SCREEN)}`);
  if (r.create.items > 0) lines.push(`Товаров будет создано: ${r.create.items} — ${namesText(r.names.items, r.create.items)}`);
  // группы и пропуск — у каталога, поставщики — у поступлений
  if (kind === 'items' && r.create.groups > 0) lines.push(`Групп будет создано: ${r.create.groups} — ${namesText(r.names.groups, r.create.groups)}`);
  if (kind === 'receipts' && r.create.suppliers > 0) lines.push(`Поставщиков будет создано: ${r.create.suppliers} — ${namesText(r.names.suppliers, r.create.suppliers)}`);
  if (kind === 'items' && r.skip.items > 0) lines.push(`Уже есть в каталоге (пропуск): ${r.skip.items}`);
  return lines;
}

/** Ошибка загрузки файла понятным текстом: «слишком большой» сервер отдаёт без нашего сообщения. */
export function importFileError(e: { status: number; message: string }): string {
  if (e.status === 413) return 'Файл больше 5 МБ — разделите его на части';
  return e.message;
}

/** Ссылка «Скачать шаблон» (спецификация 2026-10-19, часть 4): файл собирается по текущим данным компании. */
export function stockTemplateHref(companyId: number, kind: StockImportKind): string {
  return `/api/v1/companies/${companyId}/stock/import/${kind}/template.xlsx`;
}

/** Подпись рядом с «Выбрать файл»: имя выбранного файла или «Файл не выбран». */
export function chosenFileText(file: { name: string } | null): string {
  return file?.name ?? 'Файл не выбран';
}
