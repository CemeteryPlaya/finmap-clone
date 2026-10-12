import { damaged, fileError, IMPORT_READ_MAX_ROWS, tooManyRows } from './errors';
import { scanXml } from './xml';
import { openZip, ZIP_MAX_ENTRIES, ZIP_MAX_TOTAL } from './zip';

/**
 * Ячейка листа (§3.3 спецификации импорта): число — текстом, как в `<v>` (в number не превращается, §4.2);
 * error — ошибка Excel (`#N/A`) или слишком длинный текст (CELL_TOO_LONG).
 */
export interface Cell {
  kind: 'number' | 'text' | 'error';
  value: string;
}

/** Строка листа: номер строки Excel и непустые ячейки по номеру столбца с нуля (A — 0, AA — 26). */
export interface SheetRow {
  row: number;
  cells: Map<number, Cell>;
}

export interface SheetData {
  rows: SheetRow[];
  /** `<workbookPr date1904="1">`: к числам-датам прибавляется 1 462 дня. */
  date1904: boolean;
}

/** Значение ячейки длиннее предела Excel — ошибка строки R18. */
export const CELL_TOO_LONG = '#TOO_LONG';
/** Предел Excel на текст ячейки; действует на ячейку любого вида (число, текст, ошибка) в XLSX и на поле CSV. */
export const CELL_MAX_CHARS = 32_767;

const MB = 1024 * 1024;

export interface XlsxLimits {
  sheet: number;
  sharedStrings: number;
  workbook: number;
  rels: number;
  total: number;
  entries: number;
  sharedCount: number;
  /** Непустых строк листа: больше — F5 сразу, не дочитывая лист. */
  rows: number;
  /**
   * Символов во всех ячейках листа (текст, числа, ошибки), с повторами общих строк: одна общая строка в 32 767 символов,
   * на которую ссылается каждая ячейка, иначе стоила бы десятков секунд разбора. Больше — F3.
   */
  text: number;
}

/** Пределы распаковки §3.1 и общих строк §3.3. */
export const XLSX_LIMITS: XlsxLimits = {
  sheet: 64 * MB,
  sharedStrings: 32 * MB,
  workbook: MB,
  rels: MB,
  total: ZIP_MAX_TOTAL,
  entries: ZIP_MAX_ENTRIES,
  sharedCount: 1_000_000,
  rows: IMPORT_READ_MAX_ROWS,
  text: 64 * MB,
};

const MAX_ROW = 1_048_576;
const MAX_COL = 16_384;

/** Буквы столбца ссылки ячейки → номер с нуля: «A15» → 0, «AA15» → 26; null — не ссылка. */
export function columnIndex(ref: string): number | null {
  const m = /^([A-Z]{1,3})[0-9]+$/.exec(ref);
  if (!m) return null;
  let n = 0;
  for (const ch of m[1]!) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
}

/** Путь части пакета по Target связи относительно `xl/`; `..` выше корня — F3. */
export function resolvePart(target: string): string {
  const parts = target.startsWith('/') ? [] : ['xl'];
  for (const seg of target.replace(/^\/+/, '').split('/')) {
    if (seg === '' || seg === '.') continue;
    if (seg === '..') {
      if (parts.length === 0) throw damaged('неверная ссылка на лист');
      parts.pop();
    } else parts.push(seg);
  }
  return parts.join('/');
}

/** Первый лист книги: файл листа по связи первого `<sheet>` и признак date1904. */
function firstSheet(workbook: string, rels: string | null): { path: string; date1904: boolean } {
  // объект, а не let: присваивания внутри обработчиков TypeScript не видит
  const found: { rid: string | null; date1904: boolean; target: string | null } = { rid: null, date1904: false, target: null };
  scanXml(workbook, {
    open(name, attrs) {
      if (name === 'workbookPr') found.date1904 = attrs.date1904 === '1' || attrs.date1904 === 'true';
      if (name === 'sheet' && found.rid === null) {
        const key = Object.keys(attrs).find((k) => k.endsWith(':id'));
        found.rid = key ? attrs[key]! : '';
      }
    },
    text() {},
    close() {},
  });
  if (found.rid === null) throw damaged('в книге нет листов');
  if (rels !== null) {
    scanXml(rels, {
      open(name, attrs) {
        if (name === 'Relationship' && attrs.Id === found.rid && found.target === null) found.target = attrs.Target ?? null;
      },
      text() {},
      close() {},
    });
  }
  // sheet1.xml — только когда файла связей нет совсем; есть файл, но нет нужной связи — повреждён
  if (rels !== null && !found.target) throw damaged('в связях книги нет первого листа');
  return { path: found.target ? resolvePart(found.target) : 'xl/worksheets/sheet1.xml', date1904: found.date1904 };
}

/** Общие строки: `<si>` с несколькими `<r><t>` склеивается; фонетика `<rPh>` пропускается. */
function sharedStrings(xml: string, maxCount: number): string[] {
  const out: string[] = [];
  let cur: string | null = null;
  let inT = false;
  let phonetic = 0;
  scanXml(xml, {
    open(name) {
      if (name === 'si') {
        if (out.length >= maxCount) throw damaged('слишком много общих строк');
        cur = '';
      } else if (name === 'rPh') phonetic++;
      else if (name === 't' && cur !== null && phonetic === 0) inT = true;
    },
    text(v) {
      if (inT) cur += v;
    },
    close(name) {
      if (name === 't') inT = false;
      else if (name === 'rPh') phonetic--;
      else if (name === 'si') {
        out.push(cur ?? '');
        cur = null;
      }
    },
  });
  return out;
}

/** Лист → строки ячеек. Пустые ячейки (в том числе `t="str"` без `<v>`, как пишет Finmap) и пустые строки не хранятся. */
function sheetRows(xml: string, shared: string[], maxRows: number, maxText: number): SheetRow[] {
  let textTotal = 0;
  const rows: SheetRow[] = [];
  let row: SheetRow | null = null;
  let prevRow = 0;
  let col = -1;
  let type = 'n';
  let v: string | null = null;
  let inline: string | null = null;
  let mode: 'v' | 't' | null = null;
  let inIs = false;
  let phonetic = 0;

  const finishCell = () => {
    let cell: Cell | null;
    switch (type) {
      case 'n':
        cell = v === null || v.trim() === '' ? null : { kind: 'number', value: v.trim() };
        break;
      case 's': {
        const idx = v === null ? NaN : Number(v.trim());
        if (!Number.isInteger(idx) || idx < 0 || idx >= shared.length) throw damaged('ссылка на общую строку вне таблицы');
        cell = { kind: 'text', value: shared[idx]! };
        break;
      }
      case 'str':
      case 'd':
        cell = { kind: 'text', value: v ?? '' };
        break;
      case 'inlineStr':
        cell = { kind: 'text', value: inline ?? '' };
        break;
      case 'b':
        cell = v === null ? null : { kind: 'text', value: v.trim() === '1' ? 'TRUE' : 'FALSE' };
        break;
      case 'e':
        cell = { kind: 'error', value: v?.trim() || '#ERROR' };
        break;
      default:
        throw damaged(`неизвестный тип ячейки «${type}»`);
    }
    // предел ячейки и бюджет текста — у ячейки любого вида: число из миллионов цифр иначе обошло бы оба (решение 22)
    if (cell && cell.value.length > CELL_MAX_CHARS) cell = { kind: 'error', value: CELL_TOO_LONG };
    if (cell && (textTotal += cell.value.length) > maxText) throw damaged('слишком много текста в листе');
    if (cell && cell.value !== '') row!.cells.set(col, cell);
  };

  scanXml(xml, {
    open(name, attrs) {
      if (name === 'row') {
        const r = attrs.r === undefined ? prevRow + 1 : Number(attrs.r);
        if (!Number.isInteger(r) || r < 1 || r > MAX_ROW) throw damaged('неверный номер строки листа');
        row = { row: r, cells: new Map() };
        prevRow = r;
        col = -1;
      } else if (name === 'c') {
        if (!row) throw damaged('ячейка вне строки');
        if (attrs.r !== undefined) {
          const c = columnIndex(attrs.r);
          if (c === null || c >= MAX_COL) throw damaged('неверная ссылка ячейки');
          col = c;
        } else if (++col >= MAX_COL) throw damaged('неверная ссылка ячейки');
        type = attrs.t ?? 'n';
        v = null;
        inline = null;
      } else if (name === 'v' && row) {
        mode = 'v';
        v = '';
      } else if (name === 'is') inIs = true;
      else if (name === 'rPh') phonetic++;
      else if (name === 't' && inIs && phonetic === 0) {
        mode = 't';
        inline ??= '';
      }
    },
    text(value) {
      if (mode === 'v') v += value;
      else if (mode === 't') inline += value;
    },
    close(name) {
      if (name === 'v' || name === 't') mode = null;
      else if (name === 'is') inIs = false;
      else if (name === 'rPh') phonetic--;
      else if (name === 'c' && row) finishCell();
      else if (name === 'row' && row) {
        if (row.cells.size > 0 && rows.push(row) > maxRows) throw tooManyRows();
        row = null;
      }
    },
  });
  return rows;
}

/**
 * Первый лист XLSX (§3.3): первый `<sheet>` книги по связи, общие строки, типы ячеек. Формулы не вычисляются —
 * берётся сохранённый `<v>`; стили не читаются. Нет книги `xl/workbook.xml` — F2 (это не XLSX).
 */
export function readXlsx(data: Buffer, limits: XlsxLimits = XLSX_LIMITS): SheetData {
  const zip = openZip(data, { maxEntries: limits.entries, maxTotal: limits.total });
  const workbook = zip.read('xl/workbook.xml', limits.workbook);
  if (!workbook) throw fileError('F2', 'Нужен файл .xlsx или .csv');
  const rels = zip.read('xl/_rels/workbook.xml.rels', limits.rels);
  const sheet = firstSheet(workbook.toString('utf8'), rels ? rels.toString('utf8') : null);
  const sst = zip.read('xl/sharedStrings.xml', limits.sharedStrings);
  const shared = sst ? sharedStrings(sst.toString('utf8'), limits.sharedCount) : [];
  const sheetXml = zip.read(sheet.path, limits.sheet);
  if (!sheetXml) throw damaged('нет файла первого листа');
  return { rows: sheetRows(sheetXml.toString('utf8'), shared, limits.rows, limits.text), date1904: sheet.date1904 };
}
