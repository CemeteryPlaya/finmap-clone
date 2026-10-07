import AdmZip from 'adm-zip';

/**
 * Ячейка листа:
 * - text — строка (inline string: без общей таблицы строк, формулой не считается);
 * - number — десятичная запись без экспоненты («-1500.50») и число знаков после запятой для формата;
 * - datetime / date — дата Excel: дни от 30.12.1899, у datetime — с долей суток.
 */
export type XlsxCell =
  | { kind: 'text'; value: string }
  | { kind: 'number'; value: string; decimals: number }
  | { kind: 'datetime'; value: number }
  | { kind: 'date'; value: number }
  | null;

export interface XlsxSheet {
  /** Имя листа: до 31 символа, без []:*?/\. */
  name: string;
  columns: { header: string; width: number }[];
  rows: XlsxCell[][];
}

export const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

/** Индексы стилей в cellXfs (styles.xml ниже). */
const STYLE = { header: 1, datetime: 2, date: 3, int: 4, dec2: 5, dec3: 6, quoted: 7 } as const;

const HEAD = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n';
const NS_MAIN = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main';
const NS_REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const NS_PKG_REL = 'http://schemas.openxmlformats.org/package/2006/relationships';

const CONTENT_TYPES = `<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/></Types>`;
const ROOT_RELS = `<Relationships xmlns="${NS_PKG_REL}"><Relationship Id="rId1" Type="${NS_REL}/officeDocument" Target="xl/workbook.xml"/></Relationships>`;
const WORKBOOK_RELS = `<Relationships xmlns="${NS_PKG_REL}"><Relationship Id="rId1" Type="${NS_REL}/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="${NS_REL}/styles" Target="styles.xml"/></Relationships>`;
// 164 — дата и время, 165 — дата, 166 — три знака после запятой; 3 и 4 — встроенные «# ##0» и «# ##0,00»;
// последний xf — quotePrefix: Excel показывает текст как есть и не превращает его в формулу при правке ячейки
const STYLES = `<styleSheet xmlns="${NS_MAIN}"><numFmts count="3"><numFmt numFmtId="164" formatCode="dd.mm.yyyy hh:mm"/><numFmt numFmtId="165" formatCode="dd.mm.yyyy"/><numFmt numFmtId="166" formatCode="#,##0.000"/></numFmts><fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font></fonts><fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills><borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="8"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/><xf numFmtId="164" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/><xf numFmtId="165" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/><xf numFmtId="3" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/><xf numFmtId="4" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/><xf numFmtId="166" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0" quotePrefix="1"/></cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>`;

/** Символы, недопустимые в XML 1.0: управляющие (кроме табуляции и переводов строки), одиночные суррогаты, U+FFFE и U+FFFF. */
const INVALID_XML = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\uFFFE\uFFFF]|[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g;

/** Текст без символов, недопустимых в XML. */
const clean = (s: string) => s.replace(INVALID_XML, '');

/** Текст для XML: недопустимые символы удаляются, & < > " экранируются, CR — ссылкой (иначе парсер превратит его в LF). */
export function xmlText(s: string): string {
  return clean(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/\r/g, '&#13;');
}

/** Номер столбца с нуля → буквы Excel: 0 → A, 25 → Z, 26 → AA. */
export function columnName(index: number): string {
  let n = index + 1;
  let s = '';
  while (n > 0) {
    const r = (n - 1) % 26;
    s = String.fromCharCode(65 + r) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}

/** Начало текста, которое Excel и LibreOffice при правке или импорте принимают за формулу. */
const FORMULA_START = /^[=+\-@\t\r]/;

function numberStyle(decimals: number): number {
  if (decimals === 0) return STYLE.int;
  if (decimals === 2) return STYLE.dec2;
  if (decimals === 3) return STYLE.dec3;
  throw new Error(`Неподдерживаемое число знаков после запятой: ${decimals}`);
}

function cellXml(ref: string, cell: XlsxCell, style?: number): string {
  if (cell === null) return '';
  switch (cell.kind) {
    case 'text': {
      // формул в листе нет (<f> не пишется); текст, похожий на формулу, — со стилем quotePrefix
      const value = xmlText(cell.value);
      const s = style ?? (FORMULA_START.test(clean(cell.value)) ? STYLE.quoted : 0);
      return `<c r="${ref}" t="inlineStr"${s ? ` s="${s}"` : ''}><is><t xml:space="preserve">${value}</t></is></c>`;
    }
    case 'number':
      return `<c r="${ref}" s="${numberStyle(cell.decimals)}"><v>${cell.value}</v></c>`;
    case 'datetime':
      return `<c r="${ref}" s="${STYLE.datetime}"><v>${cell.value}</v></c>`;
    case 'date':
      return `<c r="${ref}" s="${STYLE.date}"><v>${cell.value}</v></c>`;
  }
}

function sheetXml(sheet: XlsxSheet): string {
  const cols = sheet.columns.map((c, i) => `<col min="${i + 1}" max="${i + 1}" width="${c.width}" customWidth="1"/>`).join('');
  const header = `<row r="1">${sheet.columns.map((c, i) => cellXml(`${columnName(i)}1`, { kind: 'text', value: c.header }, STYLE.header)).join('')}</row>`;
  const body = sheet.rows.map((row, r) => `<row r="${r + 2}">${row.map((cell, i) => cellXml(`${columnName(i)}${r + 2}`, cell)).join('')}</row>`);
  // строка заголовков закреплена
  return `<worksheet xmlns="${NS_MAIN}"><sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews><cols>${cols}</cols><sheetData>${header}${body.join('')}</sheetData></worksheet>`;
}

/** Минимальная книга XLSX с одним листом (ECMA-376): строки — inline, числа и даты — с форматом. */
export function buildXlsx(sheet: XlsxSheet): Buffer {
  const zip = new AdmZip();
  const add = (name: string, xml: string) => zip.addFile(name, Buffer.from(HEAD + xml, 'utf8'));
  add('[Content_Types].xml', CONTENT_TYPES);
  add('_rels/.rels', ROOT_RELS);
  add('xl/workbook.xml', `<workbook xmlns="${NS_MAIN}" xmlns:r="${NS_REL}"><bookViews><workbookView/></bookViews><sheets><sheet name="${xmlText(sheet.name)}" sheetId="1" r:id="rId1"/></sheets></workbook>`);
  add('xl/_rels/workbook.xml.rels', WORKBOOK_RELS);
  add('xl/styles.xml', STYLES);
  add('xl/worksheets/sheet1.xml', sheetXml(sheet));
  return zip.toBuffer();
}
