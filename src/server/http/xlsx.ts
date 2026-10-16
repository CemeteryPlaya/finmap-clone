import AdmZip from 'adm-zip';

/**
 * Ячейка листа:
 * - text — строка (inline или из таблицы общих строк — XlsxOptions.strings; формулой не считается);
 * - number — десятичная запись без экспоненты («-1500.50») и число знаков после запятой для формата;
 * - datetime / date — дата Excel: дни от 30.12.1899, у datetime — с долей суток.
 * bold — полужирный шрифт (строка «Итого» в «Собрать Excel»).
 */
export type XlsxCell =
  | { kind: 'text'; value: string; bold?: boolean }
  | { kind: 'number'; value: string; decimals: number; bold?: boolean }
  | { kind: 'datetime'; value: number }
  | { kind: 'date'; value: number }
  | null;

export interface XlsxSheet {
  /** Имя листа: до 31 символа, без []:*?/\. */
  name: string;
  columns: { header: string; width: number }[];
  rows: XlsxCell[][];
  /**
   * Строки над заголовками (сведения об отчёте: период, фильтры): идут с первой строки листа, за ними — пустая строка и
   * строка заголовков, которая закрепляется. Без них заголовки — в первой строке.
   */
  preamble?: XlsxCell[][];
}

export const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

export interface XlsxOptions {
  /**
   * Тексты: inline (по умолчанию) или таблица общих строк xl/sharedStrings.xml — её понимает любой читатель XLSX
   * (§8.2 спецификации импорта).
   */
  strings?: 'inline' | 'shared';
}

/** Индексы стилей в cellXfs (styles.xml ниже). */
const STYLE = { header: 1, datetime: 2, date: 3, int: 4, dec2: 5, dec3: 6, quoted: 7, boldInt: 8, boldDec2: 9, boldDec3: 10 } as const;

const HEAD = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n';
const NS_MAIN = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main';
const NS_REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const NS_PKG_REL = 'http://schemas.openxmlformats.org/package/2006/relationships';

const CT = 'application/vnd.openxmlformats-officedocument.spreadsheetml';
/** Типы частей пакета: книга, листы sheet1..N, стили и (если есть) общие строки. */
function contentTypes(sheets: number, shared: boolean): string {
  const parts = [
    `<Override PartName="/xl/workbook.xml" ContentType="${CT}.sheet.main+xml"/>`,
    ...Array.from({ length: sheets }, (_, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="${CT}.worksheet+xml"/>`),
    `<Override PartName="/xl/styles.xml" ContentType="${CT}.styles+xml"/>`,
    ...(shared ? [`<Override PartName="/xl/sharedStrings.xml" ContentType="${CT}.sharedStrings+xml"/>`] : []),
  ];
  return `<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/>${parts.join('')}</Types>`;
}
const ROOT_RELS = `<Relationships xmlns="${NS_PKG_REL}"><Relationship Id="rId1" Type="${NS_REL}/officeDocument" Target="xl/workbook.xml"/></Relationships>`;
/** Связи книги: листы rId1..rIdN, стили rId(N+1), общие строки rId(N+2). */
function workbookRels(sheets: number, shared: boolean): string {
  const rels = [
    ...Array.from({ length: sheets }, (_, i) => `<Relationship Id="rId${i + 1}" Type="${NS_REL}/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`),
    `<Relationship Id="rId${sheets + 1}" Type="${NS_REL}/styles" Target="styles.xml"/>`,
    ...(shared ? [`<Relationship Id="rId${sheets + 2}" Type="${NS_REL}/sharedStrings" Target="sharedStrings.xml"/>`] : []),
  ];
  return `<Relationships xmlns="${NS_PKG_REL}">${rels.join('')}</Relationships>`;
}
// 164 — дата и время, 165 — дата, 166 — три знака после запятой; 3 и 4 — встроенные «# ##0» и «# ##0,00»;
// xf 7 — quotePrefix: Excel показывает текст как есть и не превращает его в формулу при правке ячейки;
// xf 8–10 — те же три числовых формата полужирным шрифтом (строка «Итого»)
const STYLES = `<styleSheet xmlns="${NS_MAIN}"><numFmts count="3"><numFmt numFmtId="164" formatCode="dd.mm.yyyy hh:mm"/><numFmt numFmtId="165" formatCode="dd.mm.yyyy"/><numFmt numFmtId="166" formatCode="#,##0.000"/></numFmts><fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font></fonts><fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills><borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="11"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/><xf numFmtId="164" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/><xf numFmtId="165" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/><xf numFmtId="3" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/><xf numFmtId="4" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/><xf numFmtId="166" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0" quotePrefix="1"/><xf numFmtId="3" fontId="1" fillId="0" borderId="0" xfId="0" applyNumberFormat="1" applyFont="1"/><xf numFmtId="4" fontId="1" fillId="0" borderId="0" xfId="0" applyNumberFormat="1" applyFont="1"/><xf numFmtId="166" fontId="1" fillId="0" borderId="0" xfId="0" applyNumberFormat="1" applyFont="1"/></cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>`;

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

function numberStyle(decimals: number, bold = false): number {
  if (decimals === 0) return bold ? STYLE.boldInt : STYLE.int;
  if (decimals === 2) return bold ? STYLE.boldDec2 : STYLE.dec2;
  if (decimals === 3) return bold ? STYLE.boldDec3 : STYLE.dec3;
  throw new Error(`Неподдерживаемое число знаков после запятой: ${decimals}`);
}

/** Таблица общих строк: индекс по первому появлению; count — число ссылок, uniqueCount — строк. */
class SharedStrings {
  private readonly index = new Map<string, number>();
  readonly list: string[] = [];
  count = 0;

  ref(text: string): number {
    this.count++;
    let i = this.index.get(text);
    if (i === undefined) {
      i = this.list.length;
      this.index.set(text, i);
      this.list.push(text);
    }
    return i;
  }

  xml(): string {
    const items = this.list.map((t) => `<si><t xml:space="preserve">${xmlText(t)}</t></si>`).join('');
    return `<sst xmlns="${NS_MAIN}" count="${this.count}" uniqueCount="${this.list.length}">${items}</sst>`;
  }
}

function cellXml(ref: string, cell: XlsxCell, shared: SharedStrings | null, style?: number): string {
  if (cell === null) return '';
  switch (cell.kind) {
    case 'text': {
      // формул в листе нет (<f> не пишется); текст, похожий на формулу, — со стилем quotePrefix (и в общих строках)
      const s = style ?? (cell.bold ? STYLE.header : FORMULA_START.test(clean(cell.value)) ? STYLE.quoted : 0);
      const attr = s ? ` s="${s}"` : '';
      if (shared) return `<c r="${ref}" t="s"${attr}><v>${shared.ref(clean(cell.value))}</v></c>`;
      return `<c r="${ref}" t="inlineStr"${attr}><is><t xml:space="preserve">${xmlText(cell.value)}</t></is></c>`;
    }
    case 'number':
      return `<c r="${ref}" s="${numberStyle(cell.decimals, cell.bold)}"><v>${cell.value}</v></c>`;
    case 'datetime':
      return `<c r="${ref}" s="${STYLE.datetime}"><v>${cell.value}</v></c>`;
    case 'date':
      return `<c r="${ref}" s="${STYLE.date}"><v>${cell.value}</v></c>`;
  }
}

function sheetXml(sheet: XlsxSheet, shared: SharedStrings | null): string {
  const cols = sheet.columns.map((c, i) => `<col min="${i + 1}" max="${i + 1}" width="${c.width}" customWidth="1"/>`).join('');
  const preamble = sheet.preamble ?? [];
  // за строками сведений — пустая строка, затем заголовки
  const headRow = preamble.length > 0 ? preamble.length + 2 : 1;
  const top = preamble.map((row, r) => `<row r="${r + 1}">${row.map((cell, i) => cellXml(`${columnName(i)}${r + 1}`, cell, shared)).join('')}</row>`);
  const header = `<row r="${headRow}">${sheet.columns.map((c, i) => cellXml(`${columnName(i)}${headRow}`, { kind: 'text', value: c.header }, shared, STYLE.header)).join('')}</row>`;
  const body = sheet.rows.map((row, r) => `<row r="${headRow + 1 + r}">${row.map((cell, i) => cellXml(`${columnName(i)}${headRow + 1 + r}`, cell, shared)).join('')}</row>`);
  // строка заголовков закреплена
  return `<worksheet xmlns="${NS_MAIN}"><sheetViews><sheetView workbookViewId="0"><pane ySplit="${headRow}" topLeftCell="A${headRow + 1}" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews><cols>${cols}</cols><sheetData>${top.join('')}${header}${body.join('')}</sheetData></worksheet>`;
}

/**
 * Минимальная книга XLSX (ECMA-376): один или несколько листов по порядку; строки — inline или общими строками,
 * числа и даты — с форматом. Первый лист — первый в книге (его импортирует Finmap и наш импорт).
 */
export function buildXlsx(book: XlsxSheet | XlsxSheet[], opts: XlsxOptions = {}): Buffer {
  const sheets = Array.isArray(book) ? book : [book];
  if (sheets.length === 0) throw new Error('В книге нужен хотя бы один лист');
  const shared = opts.strings === 'shared' ? new SharedStrings() : null;
  const zip = new AdmZip();
  const add = (name: string, xml: string) => zip.addFile(name, Buffer.from(HEAD + xml, 'utf8'));
  const list = sheets.map((sh, i) => `<sheet name="${xmlText(sh.name)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join('');
  add('[Content_Types].xml', contentTypes(sheets.length, shared !== null));
  add('_rels/.rels', ROOT_RELS);
  add('xl/workbook.xml', `<workbook xmlns="${NS_MAIN}" xmlns:r="${NS_REL}"><bookViews><workbookView/></bookViews><sheets>${list}</sheets></workbook>`);
  add('xl/_rels/workbook.xml.rels', workbookRels(sheets.length, shared !== null));
  add('xl/styles.xml', STYLES);
  sheets.forEach((sh, i) => add(`xl/worksheets/sheet${i + 1}.xml`, sheetXml(sh, shared)));
  // общие строки собираются при записи листов, поэтому их часть — последней
  if (shared) add('xl/sharedStrings.xml', shared.xml());
  return zip.toBuffer();
}
