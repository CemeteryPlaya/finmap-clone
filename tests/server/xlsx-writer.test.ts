import AdmZip from 'adm-zip';
import { describe, expect, it } from 'vitest';
import { buildXlsx, type XlsxSheet } from '../../src/server/http/xlsx';
import { readXlsx } from '../../src/server/modules/imports/xlsx-read';

const part = (zip: AdmZip, name: string) => zip.getEntry(name)!.getData().toString('utf8');

const SHEETS: XlsxSheet[] = [
  {
    name: 'Шаблон',
    columns: [
      { header: 'Дата платежа*', width: 10 },
      { header: 'Комментарий', width: 30 },
    ],
    rows: [
      [{ kind: 'datetime', value: 46300.5 }, { kind: 'text', value: '=SUM(A1)' }],
      [null, { kind: 'text', value: 'Комментарий' }],
    ],
  },
  { name: 'Инструкция', columns: [{ header: 'Правила', width: 80 }], rows: [[{ kind: 'text', value: '1. Импортируется только первый лист' }]] },
];

describe('писатель XLSX: несколько листов и общие строки (§8.2 спецификации импорта)', () => {
  it('листы по порядку: части пакета, связи, типы; общие строки — без повторов, count и uniqueCount', () => {
    const zip = new AdmZip(buildXlsx(SHEETS, { strings: 'shared' }));
    expect(zip.getEntries().map((e) => e.entryName).sort()).toEqual(
      [
        '[Content_Types].xml',
        '_rels/.rels',
        'xl/_rels/workbook.xml.rels',
        'xl/sharedStrings.xml',
        'xl/styles.xml',
        'xl/workbook.xml',
        'xl/worksheets/sheet1.xml',
        'xl/worksheets/sheet2.xml',
      ].sort(),
    );
    expect(part(zip, 'xl/workbook.xml')).toContain('<sheets><sheet name="Шаблон" sheetId="1" r:id="rId1"/><sheet name="Инструкция" sheetId="2" r:id="rId2"/></sheets>');
    const rels = part(zip, 'xl/_rels/workbook.xml.rels');
    expect(rels).toContain('Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet2.xml"');
    expect(rels).toContain('Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"');
    expect(rels).toContain('Id="rId4" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/sharedStrings" Target="sharedStrings.xml"');
    const types = part(zip, '[Content_Types].xml');
    expect(types).toContain('<Override PartName="/xl/worksheets/sheet2.xml"');
    expect(types).toContain('<Override PartName="/xl/sharedStrings.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sharedStrings+xml"/>');
    // «Комментарий» — заголовок и ячейка: одна общая строка на две ссылки
    expect(part(zip, 'xl/sharedStrings.xml')).toContain('count="6" uniqueCount="5"');
    const sheet1 = part(zip, 'xl/worksheets/sheet1.xml');
    expect(sheet1).toContain('<c r="A1" t="s" s="1"><v>0</v></c><c r="B1" t="s" s="1"><v>1</v></c>');
    expect(sheet1).toContain('<c r="B3" t="s"><v>1</v></c>');
    expect(sheet1).not.toContain('inlineStr');
  });

  it('текст, похожий на формулу, — quotePrefix и в общих строках; формул нет', () => {
    const zip = new AdmZip(buildXlsx(SHEETS, { strings: 'shared' }));
    const sheet1 = part(zip, 'xl/worksheets/sheet1.xml');
    expect(sheet1).toContain('<c r="B2" t="s" s="7"><v>2</v></c>');
    expect(sheet1).not.toContain('<f>');
    expect(part(zip, 'xl/sharedStrings.xml')).toContain('<si><t xml:space="preserve">=SUM(A1)</t></si>');
  });

  it('книга читается нашим читателем: первый лист — первый в книге; inline по умолчанию; пустая книга — ошибка', () => {
    const data = readXlsx(buildXlsx(SHEETS, { strings: 'shared' }));
    expect(data.rows.map((r) => [r.row, [...r.cells.values()].map((c) => c.value)])).toEqual([
      [1, ['Дата платежа*', 'Комментарий']],
      [2, ['46300.5', '=SUM(A1)']],
      [3, ['Комментарий']],
    ]);
    const inline = new AdmZip(buildXlsx(SHEETS));
    expect(inline.getEntry('xl/sharedStrings.xml')).toBeNull();
    expect(part(inline, 'xl/worksheets/sheet2.xml')).toContain('t="inlineStr"');
    expect(() => buildXlsx([])).toThrow('В книге нужен хотя бы один лист');
  });
});

describe('писатель XLSX: строки сведений над заголовками (R13)', () => {
  it('сведения - с первой строки, затем пустая строка и заголовки, закрепляются заголовки; без сведений - заголовки в первой строке', () => {
    const sheet: XlsxSheet = {
      name: 'Деньги',
      columns: [{ header: 'Название', width: 20 }, { header: 'Итого', width: 10 }],
      rows: [[{ kind: 'text', value: 'Аренда' }, { kind: 'number', value: '1.00', decimals: 2 }]],
      preamble: [[{ kind: 'text', value: 'Отчёт: Деньги', bold: true }], [{ kind: 'text', value: 'Период: 01.10.2026 – 31.10.2026' }]],
    };
    const xml = part(new AdmZip(buildXlsx(sheet, { strings: 'shared' })), 'xl/worksheets/sheet1.xml');
    expect(xml).toContain('<row r="1"><c r="A1" t="s" s="1">');
    expect(xml).toContain('<row r="2"><c r="A2" t="s">');
    expect(xml).not.toContain('<row r="3">');
    expect(xml).toContain('<row r="4"><c r="A4" t="s" s="1">');
    expect(xml).toContain('<row r="5"><c r="A5" t="s">');
    expect(xml).toContain('<pane ySplit="4" topLeftCell="A5" activePane="bottomLeft" state="frozen"/>');
    const plain = part(new AdmZip(buildXlsx({ ...sheet, preamble: undefined })), 'xl/worksheets/sheet1.xml');
    expect(plain).toContain('<pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/>');
  });
});
