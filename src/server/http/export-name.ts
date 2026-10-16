import { formatDateTime } from '../../shared/dates';

/**
 * Имя файла выгрузки (§8.1 спецификации импорта, §2.6 спецификации «Аналитика»): «{Компания} - {Что} - ДД-ММ-ГГГГ ЧЧ-ММ.xlsx»
 * по часам APP_TIMEZONE; символы, запрещённые в именах файлов Windows, — «_».
 */
export function exportFileName(company: string, title: string, at: Date, timeZone: string): string {
  const [date = '', time = ''] = formatDateTime(at.toISOString(), timeZone).split(', ');
  const safeName = company.replace(/[\\/:*?"<>|\u0000-\u001F]/g, '_');
  return `${safeName} - ${title} - ${date.replaceAll('.', '-')} ${time.replace(':', '-')}.xlsx`;
}
