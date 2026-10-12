import { readCsv } from './csv';
import { fileError } from './errors';
import { readXlsx, type SheetData } from './xlsx-read';

/** Файл импорта больше 30 МБ не принимается (§2.4): 413 TOO_LARGE. */
export const IMPORT_MAX_BYTES = 30 * 1024 * 1024;

export type ImportFileKind = 'xlsx' | 'csv';

const startsWith = (data: Buffer, sig: number[]) => data.length >= sig.length && sig.every((b, i) => data[i] === b);

/**
 * Тип файла (§3.4): ZIP — XLSX (книгу проверяет читатель, иначе F2); OLE (`D0 CF 11 E0`) — старый .xls;
 * .csv или .txt без нулевых байтов (кроме UTF-16LE с BOM) — CSV; иначе F2. Пустой файл — F1.
 */
export function detectImportFile(data: Buffer, name: string): ImportFileKind {
  if (data.length === 0) throw fileError('F1', 'Файл пустой');
  if (startsWith(data, [0x50, 0x4b, 0x03, 0x04])) return 'xlsx';
  if (startsWith(data, [0xd0, 0xcf, 0x11, 0xe0])) throw fileError('F2', 'Старый формат .xls — сохраните файл как .xlsx');
  if (/\.(csv|txt)$/i.test(name.trim()) && (startsWith(data, [0xff, 0xfe]) || !data.includes(0))) return 'csv';
  throw fileError('F2', 'Нужен файл .xlsx или .csv');
}

/** Строки первого листа XLSX или CSV. */
export function readImportFile(data: Buffer, name: string): SheetData {
  return detectImportFile(data, name) === 'xlsx' ? readXlsx(data) : readCsv(data);
}
