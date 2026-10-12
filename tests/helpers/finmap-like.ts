import { buildZip } from './zip-build';

/**
 * Синтетический файл «как у Finmap» (§11.1 спецификации импорта): лист ExportRU, заголовки с латинскими двойниками,
 * ячейки `t="str"`, пустые `t="str"` без `<v>`, даты — числа Excel с долей суток. Названия выдуманные.
 * Настоящий файл владельца в тестах не используется.
 */

/**
 * Заголовки A–P настоящей выгрузки: в части букв — латиница (экранировано, чтобы правка не «починила» её).
 * Латинские буквы: «Дата платежа» — a; «Сумма в валюте компании» — C, y, a, a, o, a; «На счет» — H; «Категория» — K, o; «Теги» — T.
 */
export const FINMAP_LIKE_HEADERS: readonly string[] = [
  'Дата пл\u0061тежа',
  'Дата начисления',
  'Период начисления (дата "с")',
  'Период начисления (дата "по")',
  'Сумма в валюте счета',
  '\u0043\u0079мм\u0061 в в\u0061люте к\u006Fмп\u0061нии',
  'Со счета',
  '\u0048а счет',
  '\u004Bатег\u006Fрия',
  'Подкатегория',
  'Контрагент',
  'Подконтрагент',
  'Проект',
  'Подпроект',
  '\u0054еги',
  'Комментарий',
];

/** Значение ячейки: строка — `t="str"` с `<v>`, число — число Excel, null — пустая `t="str"` без `<v>`. */
export type FinmapLikeValue = string | number | null;

const EXCEL_EPOCH = Date.UTC(1899, 11, 30);

/** Дата и время по часам компании → число Excel с долей суток (10 знаков, как в выгрузке). */
export function excelSerial(date: string, time = '00:00:00'): number {
  const [y, m, d] = date.split('-').map(Number) as [number, number, number];
  const [hh, mm, ss] = time.split(':').map(Number) as [number, number, number];
  const days = (Date.UTC(y, m - 1, d) - EXCEL_EPOCH) / 86_400_000;
  return Number((days + (hh * 3600 + mm * 60 + ss) / 86_400).toFixed(10));
}

/** Строка данных A–P по полям; незаданные — пустые ячейки. */
export function finmapLikeRow(v: {
  paidAt: FinmapLikeValue;
  accrual?: FinmapLikeValue;
  periodFrom?: FinmapLikeValue;
  periodTo?: FinmapLikeValue;
  amount: FinmapLikeValue;
  baseAmount?: FinmapLikeValue;
  from?: FinmapLikeValue;
  to?: FinmapLikeValue;
  category?: FinmapLikeValue;
  subcategory?: FinmapLikeValue;
  counterparty?: FinmapLikeValue;
  subcounterparty?: FinmapLikeValue;
  project?: FinmapLikeValue;
  subproject?: FinmapLikeValue;
  tags?: FinmapLikeValue;
  comment?: FinmapLikeValue;
}): FinmapLikeValue[] {
  return [
    v.paidAt,
    v.accrual ?? null,
    v.periodFrom ?? null,
    v.periodTo ?? null,
    v.amount,
    v.baseAmount ?? null,
    v.from ?? null,
    v.to ?? null,
    v.category ?? null,
    v.subcategory ?? null,
    v.counterparty ?? null,
    v.subcounterparty ?? null,
    v.project ?? null,
    v.subproject ?? null,
    v.tags ?? null,
    v.comment ?? null,
  ];
}

/**
 * Пример выгрузки: доход, зарплата с периодом начисления текстом «01.09.2026 00:00:00» – «30.09.2026 23:59:59»,
 * перевод, расход с копейками, тегами и комментарием. Время — по часам компании.
 */
export function finmapLikeSample(): FinmapLikeValue[][] {
  return [
    finmapLikeRow({ paidAt: excelSerial('2026-10-03', '22:07:00'), amount: 10596, baseAmount: 10596, to: 'Касса-1', category: 'Бар' }),
    finmapLikeRow({
      paidAt: excelSerial('2026-10-03', '22:07:30'),
      periodFrom: '01.09.2026 00:00:00',
      periodTo: '30.09.2026 23:59:59',
      amount: 8500,
      baseAmount: 8500,
      from: 'Касса-1',
      category: 'Зарплата',
      subcategory: 'Администраторы',
      counterparty: 'Сотрудник А',
    }),
    finmapLikeRow({ paidAt: excelSerial('2026-10-04', '09:15:00'), amount: 50000, baseAmount: 50000, from: 'Касса-1', to: 'Банк-2' }),
    finmapLikeRow({
      paidAt: excelSerial('2026-10-05', '00:30:00'),
      accrual: excelSerial('2026-10-01'),
      amount: 8200.5,
      baseAmount: 8200.5,
      from: 'Банк-2',
      category: 'Аренда',
      counterparty: 'Поставщик Б',
      tags: 'Смена, Ночь',
      comment: 'Аренда за октябрь',
    }),
  ];
}

/**
 * Много строк «как у Finmap» для замеров и проверки скорости (§10, §11.2): доходы на «Касса-1» и «Банк-2», расходы с
 * «Касса-1», 15 категорий доходов, «Зарплата» и 22 категории расходов, 86 контрагентов, редкие тег и комментарий.
 * Даты — с 15.03.2023, perDay строк в день (по умолчанию 14: 16 000 строк — до мая 2026), время 08:00–19:59.
 */
export function finmapLikeMany(count: number, opts: { perDay?: number } = {}): FinmapLikeValue[][] {
  const perDay = opts.perDay ?? 14;
  return Array.from({ length: count }, (_, i) => {
    const day = new Date(Date.UTC(2023, 2, 15) + Math.floor(i / perDay) * 86_400_000).toISOString().slice(0, 10);
    const income = i % 3 !== 0;
    return finmapLikeRow({
      paidAt: excelSerial(day, `${String(8 + (i % 12)).padStart(2, '0')}:${String(i % 60).padStart(2, '0')}:00`),
      amount: 1000 + (i % 977) + 0.5,
      ...(income ? { to: i % 2 ? 'Касса-1' : 'Банк-2' } : { from: 'Касса-1' }),
      category: income ? `Доход ${i % 15}` : i % 4 ? 'Зарплата' : `Расход ${i % 22}`,
      counterparty: `Контрагент ${i % 86}`,
      tags: i % 50 ? null : 'Смена',
      comment: i % 7 ? null : `Комментарий ${i}`,
    });
  });
}

const NS_MAIN = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main';
const NS_REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const NS_PKG = 'http://schemas.openxmlformats.org/package/2006/relationships';

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

function columnName(i: number): string {
  let n = i + 1;
  let s = '';
  while (n > 0) {
    const r = (n - 1) % 26;
    s = String.fromCharCode(65 + r) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}

/** XML листа: строки по порядку с номера 1, как пишет Finmap. */
export function finmapLikeSheetXml(rows: FinmapLikeValue[][]): string {
  const body = rows
    .map((row, r) => {
      const cells = row
        .map((v, c) => {
          const ref = `${columnName(c)}${r + 1}`;
          if (v === null) return `<c r="${ref}" t="str"/>`;
          if (typeof v === 'number') return `<c r="${ref}"><v>${v}</v></c>`;
          return `<c r="${ref}" t="str"><v>${esc(v)}</v></c>`;
        })
        .join('');
      return `<row r="${r + 1}">${cells}</row>`;
    })
    .join('');
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<worksheet xmlns="${NS_MAIN}" xmlns:r="${NS_REL}"><sheetData>${body}</sheetData></worksheet>`;
}

/**
 * Книга XLSX «как у Finmap»: заголовки (по умолчанию FINMAP_LIKE_HEADERS) и строки данных;
 * leadRows — строки над заголовками (название отчёта и т. п.).
 */
export function finmapLikeXlsx(
  rows: FinmapLikeValue[][] = finmapLikeSample(),
  opts: { headers?: readonly string[]; leadRows?: FinmapLikeValue[][]; sheetName?: string; date1904?: boolean } = {},
): Buffer {
  const all = [...(opts.leadRows ?? []), [...(opts.headers ?? FINMAP_LIKE_HEADERS)], ...rows];
  const pr = opts.date1904 ? '<workbookPr date1904="1"/>' : '';
  return buildZip([
    {
      name: '[Content_Types].xml',
      data: `<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/></Types>`,
    },
    { name: '_rels/.rels', data: `<Relationships xmlns="${NS_PKG}"><Relationship Id="rId1" Type="${NS_REL}/officeDocument" Target="xl/workbook.xml"/></Relationships>` },
    {
      name: 'xl/workbook.xml',
      data: `<?xml version="1.0" encoding="UTF-8"?><workbook xmlns="${NS_MAIN}" xmlns:r="${NS_REL}">${pr}<sheets><sheet name="${esc(opts.sheetName ?? 'ExportRU')}" sheetId="1" r:id="rId1"/></sheets></workbook>`,
    },
    { name: 'xl/_rels/workbook.xml.rels', data: `<Relationships xmlns="${NS_PKG}"><Relationship Id="rId1" Type="${NS_REL}/worksheet" Target="worksheets/sheet1.xml"/></Relationships>` },
    { name: 'xl/worksheets/sheet1.xml', data: finmapLikeSheetXml(all) },
  ]);
}
