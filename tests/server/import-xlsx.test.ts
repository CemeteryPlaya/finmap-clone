import { describe, expect, it } from 'vitest';
import { AppError } from '../../src/server/errors';
import { buildXlsx } from '../../src/server/http/xlsx';
import { CELL_TOO_LONG, columnIndex, readXlsx, resolvePart, XLSX_LIMITS, type SheetRow } from '../../src/server/modules/imports/xlsx-read';
import { excelSerial, FINMAP_LIKE_HEADERS, finmapLikeXlsx } from '../helpers/finmap-like';
import { buildZip } from '../helpers/zip-build';

const NS = 'xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"';

/** Книга из частей: workbook со списком листов, связи, листы, общие строки. */
function book(p: { sheets: [string, string][]; rels?: string; parts: Record<string, string>; pr?: string }): Buffer {
  const workbook = `<workbook ${NS}>${p.pr ?? ''}<sheets>${p.sheets.map(([name, rid], i) => `<sheet name="${name}" sheetId="${i + 1}" r:id="${rid}"/>`).join('')}</sheets></workbook>`;
  const entries = [{ name: 'xl/workbook.xml', data: workbook }, ...Object.entries(p.parts).map(([name, data]) => ({ name, data }))];
  if (p.rels !== undefined) entries.push({ name: 'xl/_rels/workbook.xml.rels', data: p.rels });
  return buildZip(entries);
}
const sheet = (rows: string) => `<worksheet ${NS}><sheetData>${rows}</sheetData></worksheet>`;
/** Строки листа как объект: { номер: { столбец: «вид:значение» } }. */
const flat = (rows: SheetRow[]) =>
  Object.fromEntries(rows.map((r) => [r.row, Object.fromEntries([...r.cells].map(([c, v]) => [c, `${v.kind}:${v.value}`]))]));

function f(code: string, fn: () => unknown): string {
  try {
    fn();
  } catch (e) {
    expect(e).toBeInstanceOf(AppError);
    expect((e as AppError).details).toEqual({ fileCode: code });
    return (e as AppError).message;
  }
  throw new Error(`ожидалась ${code}`);
}

describe('XLSX: первый лист (§3.3 спецификации импорта)', () => {
  it('вспомогательные: столбец по ссылке, путь части по связи', () => {
    expect(['A15', 'Z1', 'AA15', 'XFD1', 'a1', 'A'].map(columnIndex)).toEqual([0, 25, 26, 16383, null, null]);
    expect(resolvePart('worksheets/sheet2.xml')).toBe('xl/worksheets/sheet2.xml');
    expect(resolvePart('/xl/worksheets/s.xml')).toBe('xl/worksheets/s.xml');
    expect(resolvePart('../xl/./worksheets/s.xml')).toBe('xl/worksheets/s.xml');
    expect(f('F3', () => resolvePart('../../x.xml'))).toContain('неверная ссылка на лист');
  });

  it('первый лист — первый <sheet> книги по связи, а не по имени файла; без связи — sheet1.xml', () => {
    const data = book({
      sheets: [
        ['Второй', 'rId7'],
        ['Первый', 'rId1'],
      ],
      rels: `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Target="worksheets/sheet1.xml"/><Relationship Id="rId7" Target="/xl/worksheets/sheet9.xml"/></Relationships>`,
      parts: {
        'xl/worksheets/sheet1.xml': sheet('<row r="1"><c r="A1" t="inlineStr"><is><t>не тот</t></is></c></row>'),
        'xl/worksheets/sheet9.xml': sheet('<row r="1"><c r="A1" t="inlineStr"><is><t>тот</t></is></c></row>'),
      },
    });
    expect(flat(readXlsx(data).rows)).toEqual({ 1: { 0: 'text:тот' } });
    const noRels = book({ sheets: [['Л', 'rId3']], parts: { 'xl/worksheets/sheet1.xml': sheet('<row r="2"><c r="B2"><v>1</v></c></row>') } });
    expect(flat(readXlsx(noRels).rows)).toEqual({ 2: { 1: 'number:1' } });
  });

  it('общие строки с <r> склеиваются, фонетика пропускается; индекс вне таблицы — F3', () => {
    const sst = `<sst ${NS}><si><t>Касса</t></si><si><r><t>Ка</t></r><r><rPr><b/></rPr><t xml:space="preserve">сса 2</t></r><rPh><t>カ</t></rPh></si></sst>`;
    const data = (v: string) =>
      book({ sheets: [['Л', 'rId1']], parts: { 'xl/sharedStrings.xml': sst, 'xl/worksheets/sheet1.xml': sheet(`<row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1" t="s"><v>${v}</v></c></row>`) } });
    expect(flat(readXlsx(data('1')).rows)).toEqual({ 1: { 0: 'text:Касса', 1: 'text:Касса 2' } });
    expect(f('F3', () => readXlsx(data('2')))).toBe('Файл повреждён или небезопасен: ссылка на общую строку вне таблицы');
    expect(f('F3', () => readXlsx(data('x')))).toContain('вне таблицы');
  });

  it('типы ячеек: n, inlineStr, str (без <v> — пусто), b, e, d; формула — сохранённое значение; пропуски столбцов, AA, ячейки и строки без r', () => {
    const rows = [
      '<row r="3"><c r="A3"><v>10596</v></c><c r="C3" t="inlineStr"><is><t>текст</t></is></c><c t="str"><v>str</v></c><c r="AA3" t="str"/></row>',
      '<row><c r="A4" t="b"><v>1</v></c><c r="B4" t="b"><v>0</v></c><c r="C4" t="e"><v>#N/A</v></c><c r="D4" t="d"><v>2026-10-05T10:00:00</v></c></row>',
      '<row r="7"><c r="A7"><f>SUM(A1:A2)</f><v>1.2345E+5</v></c><c r="B7" t="str"><f>A1&amp;"x"</f><v>итог</v></c><c r="C7"><v></v></c></row>',
      '<row r="8"><c r="A8" t="str"/><c r="B8"/></row>',
    ];
    expect(flat(readXlsx(book({ sheets: [['Л', 'rId1']], parts: { 'xl/worksheets/sheet1.xml': sheet(rows.join('')) } })).rows)).toEqual({
      3: { 0: 'number:10596', 2: 'text:текст', 3: 'text:str' },
      4: { 0: 'text:TRUE', 1: 'text:FALSE', 2: 'error:#N/A', 3: 'text:2026-10-05T10:00:00' },
      7: { 0: 'number:1.2345E+5', 1: 'text:итог' },
    });
  });

  it('date1904; текст длиннее 32 767 символов — ячейка-ошибка; неизвестный тип — F3', () => {
    const one = (cells: string, pr?: string) => book({ sheets: [['Л', 'rId1']], pr, parts: { 'xl/worksheets/sheet1.xml': sheet(`<row r="1">${cells}</row>`) } });
    expect(readXlsx(one('<c r="A1"><v>1</v></c>', '<workbookPr date1904="1"/>')).date1904).toBe(true);
    expect(readXlsx(one('<c r="A1"><v>1</v></c>', '<workbookPr date1904="0"/>')).date1904).toBe(false);
    const long = `<c r="A1" t="inlineStr"><is><t>${'я'.repeat(32_768)}</t></is></c><c r="B1" t="inlineStr"><is><t>${'я'.repeat(32_767)}</t></is></c>`;
    const r = readXlsx(one(long)).rows[0]!;
    expect(r.cells.get(0)).toEqual({ kind: 'error', value: CELL_TOO_LONG });
    expect(r.cells.get(1)!.value).toHaveLength(32_767);
    expect(f('F3', () => readXlsx(one('<c r="A1" t="zz"><v>1</v></c>')))).toContain('неизвестный тип ячейки');
  });

  it('файл «как у Finmap»: заголовки с латинскими двойниками, t="str", пустые str без <v>, даты — числа с долей суток', () => {
    const data = readXlsx(finmapLikeXlsx());
    expect(data.date1904).toBe(false);
    const [head, income, salary] = data.rows;
    expect(head!.row).toBe(1);
    expect([...head!.cells.values()].map((c) => c.value)).toEqual([...FINMAP_LIKE_HEADERS]);
    expect(head!.cells.get(0)!.value).not.toBe('Дата платежа');
    expect(income!.cells.get(0)).toEqual({ kind: 'number', value: String(excelSerial('2026-10-03', '22:07:00')) });
    expect(income!.cells.get(7)).toEqual({ kind: 'text', value: 'Касса-1' });
    expect(income!.cells.has(6)).toBe(false); // пустая «Со счета» — t="str" без <v>
    expect(salary!.cells.get(2)).toEqual({ kind: 'text', value: '01.09.2026 00:00:00' });
    expect(salary!.cells.get(3)).toEqual({ kind: 'text', value: '30.09.2026 23:59:59' });
  });

  it('наша книга (inline-строки, писатель buildXlsx) читается тем же читателем', () => {
    const data = buildXlsx({ name: 'Лист', columns: [{ header: 'Дата платежа*', width: 10 }], rows: [[{ kind: 'number', value: '1500.50', decimals: 2 }]] });
    expect(flat(readXlsx(data).rows)).toEqual({ 1: { 0: 'text:Дата платежа*' }, 2: { 0: 'number:1500.50' } });
  });

  it('не книга Excel (ZIP без xl/workbook.xml) — F2; нет файла листа — F3; пределы частей и строк передаются параметром', () => {
    expect(f('F2', () => readXlsx(buildZip([{ name: 'word/document.xml', data: '<w/>' }])))).toBe('Нужен файл .xlsx или .csv');
    expect(f('F3', () => readXlsx(book({ sheets: [['Л', 'rId1']], parts: {} })))).toContain('нет файла первого листа');
    expect(f('F3', () => readXlsx(finmapLikeXlsx(), { ...XLSX_LIMITS, sheet: 100 }))).toContain('больше предела распаковки');
    expect(f('F3', () => readXlsx(book({ sheets: [], parts: {} })))).toContain('в книге нет листов');
    // строк больше предела — F5 сразу, лист не дочитывается (в примере 5 непустых строк)
    expect(readXlsx(finmapLikeXlsx(), { ...XLSX_LIMITS, rows: 5 }).rows).toHaveLength(5);
    expect(f('F5', () => readXlsx(finmapLikeXlsx(), { ...XLSX_LIMITS, rows: 4 }))).toBe('В файле больше 50 000 строк — разбейте его по годам');
  });

  it('пределы общих строк и текста: число общих строк и символов текста передаются параметром; одна огромная общая строка в каждой ячейке — F3 быстро', () => {
    const sst = (n: number, value = 'a') => `<sst ${NS}>${`<si><t>${value}</t></si>`.repeat(n)}</sst>`;
    const withShared = (n: number, cells: string, value?: string) =>
      book({ sheets: [['Л', 'rId1']], parts: { 'xl/sharedStrings.xml': sst(n, value), 'xl/worksheets/sheet1.xml': sheet(cells) } });
    const ref = (r: number) => `<row r="${r}"><c r="A${r}" t="s"><v>0</v></c></row>`;
    expect(readXlsx(withShared(2, ref(1)), { ...XLSX_LIMITS, sharedCount: 2 }).rows).toHaveLength(1);
    expect(f('F3', () => readXlsx(withShared(3, ref(1)), { ...XLSX_LIMITS, sharedCount: 2 }))).toBe('Файл повреждён или небезопасен: слишком много общих строк');
    const rows = (n: number) => Array.from({ length: n }, (_, i) => ref(i + 1)).join('');
    expect(readXlsx(withShared(1, rows(2), 'x'.repeat(50)), { ...XLSX_LIMITS, text: 100 }).rows).toHaveLength(2);
    expect(f('F3', () => readXlsx(withShared(1, rows(3), 'x'.repeat(50)), { ...XLSX_LIMITS, text: 100 }))).toBe(
      'Файл повреждён или небезопасен: слишком много текста в листе',
    );
    // 3 000 ссылок на строку в 32 767 символов — почти 100 млн символов при пределе 64 МБ (Review Focus)
    const t0 = performance.now();
    expect(f('F3', () => readXlsx(withShared(1, rows(3000), 'я'.repeat(32_767))))).toContain('слишком много текста');
    expect(performance.now() - t0).toBeLessThan(10000);
  });

  it('файл связей есть, но нужной связи нет — F3 (sheet1.xml только без файла связей)', () => {
    const rels = '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId9" Target="worksheets/sheet1.xml"/></Relationships>';
    const parts = { 'xl/worksheets/sheet1.xml': sheet('<row r="1"><c r="A1"><v>1</v></c></row>') };
    expect(f('F3', () => readXlsx(book({ sheets: [['Л', 'rId1']], rels, parts })))).toBe('Файл повреждён или небезопасен: в связях книги нет первого листа');
    expect(readXlsx(book({ sheets: [['Л', 'rId1']], parts })).rows).toHaveLength(1);
  });

  it('ячейки без r: столбец за пределом XFD — F3', () => {
    const row = (n: number) => book({ sheets: [['Л', 'rId1']], parts: { 'xl/worksheets/sheet1.xml': sheet(`<row r="1">${'<c><v>1</v></c>'.repeat(n)}</row>`) } });
    expect(readXlsx(row(16_384)).rows[0]!.cells.size).toBe(16_384);
    expect(f('F3', () => readXlsx(row(16_385)))).toBe('Файл повреждён или небезопасен: неверная ссылка ячейки');
  });

  it('заголовки-двойники: пять заголовков с латиницей отличаются от чистого написания и совпадают с ним после замены латиницы на кириллицу', () => {
    const clean = [
      'Дата платежа', 'Дата начисления', 'Период начисления (дата "с")', 'Период начисления (дата "по")', 'Сумма в валюте счета',
      'Сумма в валюте компании', 'Со счета', 'На счет', 'Категория', 'Подкатегория', 'Контрагент', 'Подконтрагент', 'Проект', 'Подпроект',
      'Теги', 'Комментарий',
    ];
    // латинская буква → кириллический двойник, по кодам символов (в тексте файла латиницы нет)
    const twin = new Map<number, number>([[0x61, 0x430], [0x43, 0x421], [0x79, 0x443], [0x6f, 0x43e], [0x48, 0x41d], [0x4b, 0x41a], [0x54, 0x422]]);
    const normalize = (s: string) => [...s].map((ch) => String.fromCodePoint(twin.get(ch.codePointAt(0)!) ?? ch.codePointAt(0)!)).join('');
    expect(FINMAP_LIKE_HEADERS.map(normalize)).toEqual(clean);
    expect(FINMAP_LIKE_HEADERS.flatMap((h, i) => (h !== clean[i] ? [i] : []))).toEqual([0, 5, 7, 8, 14]);
  });
});
