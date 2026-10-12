import { countKnownHeaders, isHeaderRow } from '../../../shared/finmap-format';
import { damaged, fileError, IMPORT_READ_MAX_ROWS, tooManyRows } from './errors';
import type { SheetData, SheetRow } from './xlsx-read';

/** CSV (§2.5 спецификации импорта): колонки и строка заголовков — как у XLSX; значения — всегда текст. */
export type CsvEncoding = 'utf-8' | 'utf-16le' | 'windows-1251';

/** Не больше полей в строке и символов в строке (§2.5). */
export const CSV_MAX_FIELDS = 64;
export const CSV_MAX_RECORD = 1024 * 1024;
/** Разделители-кандидаты в порядке предпочтения при равенстве (§2.5). */
const DELIMITERS = [';', '\t', ','] as const;
/** Строка заголовков ищется в первых 10 записях (§2.2). */
const HEADER_SEARCH = 10;

/** Кодировка по BOM, затем строгий UTF-8, иначе cp1251 (русский Excel сохраняет «CSV (разделители — точка с запятой)» в ней). */
export function decodeCsv(data: Buffer): { text: string; encoding: CsvEncoding } {
  if (data[0] === 0xef && data[1] === 0xbb && data[2] === 0xbf) {
    return { text: new TextDecoder('utf-8').decode(data.subarray(3)), encoding: 'utf-8' };
  }
  if (data[0] === 0xff && data[1] === 0xfe) return { text: new TextDecoder('utf-16le').decode(data.subarray(2)), encoding: 'utf-16le' };
  try {
    return { text: new TextDecoder('utf-8', { fatal: true }).decode(data), encoding: 'utf-8' };
  } catch {
    return { text: new TextDecoder('windows-1251').decode(data), encoding: 'windows-1251' };
  }
}

const QUOTE = 34;
const CR = 13;
const LF = 10;

/**
 * Обход записей CSV по RFC 4180: поле в кавычках, `""` внутри — кавычка, переводы строк внутри кавычек — часть значения.
 * strict — незакрытая кавычка даёт F3 (при подборе разделителя — просто конец обхода). visit вернул false — стоп.
 */
export function eachCsvRecord(text: string, delimiter: string, strict: boolean, visit: (values: string[], index: number) => boolean | void): void {
  const delim = delimiter.charCodeAt(0);
  const n = text.length;
  const isStop = (c: number) => c === delim || c === CR || c === LF;
  let record: string[] = [];
  let count = 0;
  let recordStart = 0;
  let i = 0;
  while (i <= n) {
    let value = '';
    if (text.charCodeAt(i) === QUOTE) {
      let start = i + 1;
      for (;;) {
        const q = text.indexOf('"', start);
        if (q < 0) {
          if (strict) throw damaged('незакрытая кавычка в CSV');
          return;
        }
        if (text.charCodeAt(q + 1) === QUOTE) {
          value += text.slice(start, q + 1);
          start = q + 2;
          continue;
        }
        value += text.slice(start, q);
        i = q + 1;
        break;
      }
    }
    // без кавычек (или хвост после закрывающей кавычки) — до разделителя или конца строки
    let k = i;
    while (k < n && !isStop(text.charCodeAt(k))) k++;
    value += text.slice(i, k);
    i = k;
    record.push(value);
    if (record.length > CSV_MAX_FIELDS) throw damaged(`в строке CSV больше ${CSV_MAX_FIELDS} полей`);
    if (i - recordStart > CSV_MAX_RECORD) throw damaged('строка CSV длиннее 1 МБ');
    if (i >= n) {
      visit(record, count);
      return;
    }
    const c = text.charCodeAt(i);
    if (c === delim) {
      i++;
      continue;
    }
    i += c === CR && text.charCodeAt(i + 1) === LF ? 2 : 1;
    if (visit(record, count++) === false) return;
    record = [];
    recordStart = i;
    if (i >= n) return; // перевод строки в конце файла — не ещё одна запись
  }
}

/** Первые limit записей CSV (без строгой проверки кавычек и пределов строки) — для подбора разделителя и тестов. */
export function parseCsv(text: string, delimiter: string, limit = Infinity, strict = false): string[][] {
  const records: string[][] = [];
  if (limit <= 0) return records;
  try {
    eachCsvRecord(text, delimiter, strict, (values) => records.push(values) < limit);
  } catch (e) {
    // при подборе разделителя предел строки (64 поля, 1 МБ) — не ошибка файла: этот разделитель хуже подходит,
    // считаются записи до предела; строгий разбор выбранным разделителем отклонит файл сам
    if (strict) throw e;
  }
  return records;
}

/** Разделитель, при котором в первых 10 записях распознано больше всего заголовков §2.1 (равенство — «;», TAB, «,»). */
export function chooseDelimiter(text: string): { delimiter: string; header: boolean } {
  let best: { delimiter: string; score: number; header: boolean } = { delimiter: ';', score: -1, header: false };
  for (const delimiter of DELIMITERS) {
    const head = parseCsv(text, delimiter, HEADER_SEARCH);
    const score = Math.max(0, ...head.map(countKnownHeaders));
    if (score > best.score) best = { delimiter, score, header: head.some(isHeaderRow) };
  }
  return { delimiter: best.delimiter, header: best.header };
}

/** CSV → строки ячеек: номер строки — номер записи с 1; пустые значения не хранятся. */
export function readCsv(data: Buffer): SheetData {
  const { text, encoding } = decodeCsv(data);
  const { delimiter, header } = chooseDelimiter(text);
  // cp1251 — догадка: если и в ней заголовков нет, файл в другой кодировке
  if (encoding === 'windows-1251' && !header) throw fileError('F8', 'Не удалось прочитать CSV: сохраните его в UTF-8');
  const rows: SheetRow[] = [];
  eachCsvRecord(text, delimiter, true, (values, index) => {
    const cells = new Map<number, { kind: 'text'; value: string }>();
    values.forEach((value, col) => {
      if (value.trim() !== '') cells.set(col, { kind: 'text', value });
    });
    // строк больше предела — F5 сразу, не дочитывая файл
    if (cells.size > 0 && rows.push({ row: index + 1, cells }) > IMPORT_READ_MAX_ROWS) throw tooManyRows();
  });
  return { rows, date1904: false };
}
