import { readXlsx } from '../../src/server/modules/imports/xlsx-read';

/**
 * Первый лист книги — строки значений текстом, как в файле (числа — как в `<v>`); пустые ячейки — ''. Ширина — по самой
 * широкой строке. Читает тот же разборщик, что у импорта: проверка выгрузки и круга идёт через настоящий код чтения.
 */
export function sheetRows(data: Buffer): string[][] {
  const rows = readXlsx(data).rows;
  const width = Math.max(0, ...rows.map((r) => Math.max(-1, ...r.cells.keys()) + 1));
  return rows.map((r) => Array.from({ length: width }, (_, c) => r.cells.get(c)?.value ?? ''));
}
