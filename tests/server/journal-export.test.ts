import AdmZip from 'adm-zip';
import { afterEach, describe, expect, it } from 'vitest';
import { createLedgerBalances } from '../../src/server/modules/balances/service';
import { createJournal } from '../../src/server/modules/operations/journal';
import { accrualPeriod, excelDate, excelDateTime, minorToDecimal } from '../../src/server/modules/operations/journal-export';
import { buildXlsx, columnName, xmlText } from '../../src/server/http/xlsx';
import { opsWorld, type OpsWorld } from '../helpers/ops';
import { sheetRows } from '../helpers/xlsx-rows';

let w: OpsWorld;
afterEach(async () => w?.h.t.cleanup());

const op = async (body: Record<string, unknown>) =>
  (await w.post(w.ops, { type: 'expense', accountId: w.kzt, amount: 1000, ...body })).operation.id as number;
const exportUrl = (qs = '') => `${w.ops}/export.xlsx${qs ? `?${qs}` : ''}`;
const download = async (qs = '') => {
  const res = await w.h.req('GET', exportUrl(qs));
  expect(res.statusCode, res.body).toBe(200);
  return res;
};
const sheetOf = (body: Buffer) => new AdmZip(body).getEntry('xl/worksheets/sheet1.xml')!.getData().toString('utf8');
/** Системная категория компании по ключу (у новой компании они есть). */
const systemCategory = async (key: string): Promise<number> => {
  const tree = (await w.h.req('GET', `/api/v1/companies/${w.cid}/categories`)).json() as {
    income: { id: number; systemKey: string | null }[];
    expense: { id: number; systemKey: string | null }[];
  };
  return [...tree.income, ...tree.expense].find((c) => c.systemKey === key)!.id;
};

/** Заголовки шаблона Finmap §2.1 — ровно эти тексты, со звёздочками у обязательных. */
const HEADERS = [
  'Дата платежа*',
  'Дата начисления',
  'Период начисления (дата "с")',
  'Период начисления (дата "по")',
  'Сумма в валюте счета*',
  'Сумма в валюте компании',
  'Со счета*',
  'На счет*',
  'Категория',
  'Подкатегория',
  'Контрагент',
  'Подконтрагент',
  'Проект',
  'Подпроект',
  'Теги',
  'Комментарий',
];
// индексы колонок A–P
const [A, B, C, D, E, F, G, H, I, J, K, , M, , O, P] = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15] as const;

describe('журнал: «Excel» в формате Finmap (§8.2 спецификации импорта)', () => {
  it('вспомогательные: суммы — точной десятичной записью, даты Excel по часам Алматы, буквы столбцов, текст для XML', () => {
    expect(minorToDecimal(150050, 2)).toBe('1500.50');
    expect(minorToDecimal(-5, 2)).toBe('-0.05');
    expect(minorToDecimal(30, 2)).toBe('0.30');
    expect(minorToDecimal(1234, 0)).toBe('1234');
    expect(minorToDecimal(-1234567, 3)).toBe('-1234.567');
    expect(excelDate('2026-10-05')).toBe(46300);
    expect(excelDateTime('2026-10-05T05:00:00.000Z', 'Asia/Almaty')).toBeCloseTo(46300 + 10 / 24, 9); // 10:00 по Алматы
    expect(excelDateTime('2026-10-04T19:30:00.000Z', 'Asia/Almaty')).toBeCloseTo(46300 + 0.5 / 24, 9); // 00:30 следующего дня
    // до 2024-03-01 в Алматы UTC+6: 17:30 UTC — 23:30 по местным часам того же дня (R1)
    expect(excelDateTime('2023-06-15T17:30:00.000Z', 'Asia/Almaty')).toBeCloseTo(excelDate('2023-06-15') + 23.5 / 24, 9);
    expect([0, 25, 26, 27, 701, 702].map(columnName)).toEqual(['A', 'Z', 'AA', 'AB', 'ZZ', 'AAA']);
    expect(xmlText('<b>&"\u0007\uD800ok\u{1F389}')).toBe('&lt;b&gt;&amp;&quot;ok\u{1F389}');
  });

  it('период начисления: зарплата, налоги и НДС с первым числом месяца; конец месяца — по календарю, в том числе февраль', () => {
    expect(accrualPeriod('2026-09-01', ['salary'])).toEqual({ from: '01.09.2026 00:00:00', to: '30.09.2026 23:59:59' });
    expect(accrualPeriod('2026-08-01', [null, 'tax'])).toEqual({ from: '01.08.2026 00:00:00', to: '31.08.2026 23:59:59' });
    expect(accrualPeriod('2026-02-01', ['vat'])).toEqual({ from: '01.02.2026 00:00:00', to: '28.02.2026 23:59:59' });
    expect(accrualPeriod('2028-02-01', ['salary'])).toEqual({ from: '01.02.2028 00:00:00', to: '29.02.2028 23:59:59' });
    // не первое число, не та категория, нет даты — периода нет, дата уходит в «Дату начисления»
    expect(accrualPeriod('2026-09-15', ['salary'])).toBeNull();
    expect(accrualPeriod('2026-09-01', ['dividends', null])).toBeNull();
    expect(accrualPeriod('2026-09-01', [])).toBeNull();
    expect(accrualPeriod(null, ['salary'])).toBeNull();
  });

  it('файл: лист ExportRU, заголовки шаблона, тексты общими строками, закреплённая строка; имя файла по RFC 8187 (Review Focus 4)', async () => {
    w = await opsWorld();
    await op({ paidAt: '2026-10-02T10:00:00Z', comment: 'первая' });
    const res = await download();
    expect(res.headers['content-type']).toBe('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    // «ТОО - Журнал - 06-10-2026 17-00.xlsx»: «сейчас» — 12:00 UTC, то есть 17:00 по Алматы
    expect(res.headers['content-disposition']).toBe(
      `attachment; filename="___ - ______ - 06-10-2026 17-00.xlsx"; filename*=UTF-8''${encodeURIComponent('ТОО - Журнал - 06-10-2026 17-00.xlsx')}`,
    );
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['cache-control']).toBe('private, no-store');

    const zip = new AdmZip(res.rawPayload);
    expect(zip.getEntries().map((e) => e.entryName).sort()).toEqual(
      ['[Content_Types].xml', '_rels/.rels', 'xl/_rels/workbook.xml.rels', 'xl/sharedStrings.xml', 'xl/styles.xml', 'xl/workbook.xml', 'xl/worksheets/sheet1.xml'].sort(),
    );
    expect(zip.getEntry('xl/workbook.xml')!.getData().toString('utf8')).toContain('<sheet name="ExportRU" sheetId="1" r:id="rId1"/>');
    const xml = sheetOf(res.rawPayload);
    expect(xml).not.toContain('inlineStr'); // тексты — только общими строками
    expect(xml).toContain('<pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/>');
    expect(sheetRows(res.rawPayload)[0]).toEqual(HEADERS);
    expect(new Set(HEADERS.map((h) => h.replace('*', ''))).size).toBe(16);
  });

  it('A–P: доход с разбиением, перевод между валютами, расход в USD; суммы положительные; тип — по «Со счета» и «На счет»', async () => {
    w = await opsWorld();
    // доход 1500,50 ₸ из двух строк: 1000,00 на «Клуб 1» и 500,50 на «Клуб 2»
    await op({
      type: 'income',
      paidAt: '2026-10-05T05:00:00Z',
      amount: 150050,
      accrualDate: '2026-09-30',
      counterpartyId: w.counterparty,
      tagIds: [w.tag],
      comment: 'доход',
      lines: [
        { categoryId: w.income, projectId: w.project, amount: 100000 },
        { categoryId: w.income, projectId: w.project2, amount: 50050 },
      ],
    });
    await op({ type: 'transfer', paidAt: '2026-10-04T10:00:00Z', amount: 47512, toAccountId: w.usd, toAmount: 100, comment: 'перевод', lines: [{ categoryId: null, projectId: w.project, amount: 47512 }] });
    await op({ paidAt: '2026-10-03T10:00:00Z', accountId: w.usd, amount: 100, comment: 'расход', lines: [{ categoryId: w.expense, projectId: null, amount: 100 }] });

    const rows = sheetRows((await download()).rawPayload);
    expect(rows).toHaveLength(5); // заголовок + 2 строки разбитого дохода + перевод + расход
    const [, inc1, inc2, transfer, expense] = rows as [string[], string[], string[], string[], string[]];
    // доход: «На счет» — Касса, «Со счета» пусто; E и F — суммы строки; дата платежа — число с долей суток по часам Алматы
    expect(Number(inc1[A])).toBeCloseTo(46300 + 10 / 24, 9);
    expect([inc1[B], inc1[C], inc1[D]]).toEqual(['46295', '', '']); // 30.09.2026 — не первое число: «Дата начисления»
    expect([inc1[E], inc1[F], inc1[G], inc1[H]]).toEqual(['1000.00', '1000.00', '', 'Касса']);
    expect([inc1[I], inc1[J], inc1[K], inc1[M], inc1[O], inc1[P]]).toEqual(['Бар', '', 'ИП Клиент', 'Клуб 1', 'Смена', 'доход']);
    // вторая строка разбиения: сумма и проект — свои, остальное повторяется
    expect([inc2[A], inc2[B], inc2[E], inc2[F], inc2[H], inc2[I], inc2[K], inc2[M], inc2[O], inc2[P]]).toEqual([
      inc1[A], '46295', '500.50', '500.50', 'Касса', 'Бар', 'ИП Клиент', 'Клуб 2', 'Смена', 'доход',
    ]);
    // перевод: сумма списания в валюте «Со счета», обе колонки счетов, проект строки, без категории, контрагента и даты начисления
    expect([transfer[E], transfer[F], transfer[G], transfer[H], transfer[I], transfer[K], transfer[M], transfer[B]]).toEqual(['475.12', '475.12', 'Касса', 'Валютный', '', '', 'Клуб 1', '']);
    // расход в USD: E — в валюте счёта, F — в валюте компании по курсу 475,12; знака нет, «На счет» пусто
    expect([expense[E], expense[F], expense[G], expense[H], expense[I]]).toEqual(['1.00', '475.12', 'Валютный', '', 'Аренда']);
  });

  it('зарплата, налоги и НДС с датой начисления 1-го числа уходят периодом, а не датой; подкатегория зарплаты — в «Подкатегории» (Review Focus 3)', async () => {
    w = await opsWorld();
    const salary = await systemCategory('salary');
    const tax = await systemCategory('tax');
    const vat = await systemCategory('vat');
    const staff = (await w.post(`/api/v1/companies/${w.cid}/categories`, { kind: 'expense', name: 'Администраторы', parentId: salary })).category.id as number;
    const line = (categoryId: number) => [{ categoryId, projectId: null, amount: 1000 }];
    await op({ paidAt: '2026-10-02T10:00:00Z', accrualDate: '2026-09-01', comment: 'зарплата', lines: line(staff) });
    await op({ paidAt: '2026-10-02T11:00:00Z', accrualDate: '2026-08-01', comment: 'налог', lines: line(tax) });
    await op({ paidAt: '2026-10-02T12:00:00Z', accrualDate: '2026-02-01', comment: 'ндс', lines: line(vat) });
    await op({ paidAt: '2026-10-02T13:00:00Z', accrualDate: '2026-09-15', comment: 'зарплата, середина месяца', lines: line(salary) });
    await op({ paidAt: '2026-10-02T14:00:00Z', accrualDate: '2026-09-01', comment: 'аренда', lines: line(w.expense) });
    const rows = sheetRows((await download()).rawPayload).slice(1);
    const by = (comment: string) => rows.find((r) => r[P] === comment)!;
    expect([by('зарплата')[B], by('зарплата')[C], by('зарплата')[D], by('зарплата')[I], by('зарплата')[J]]).toEqual([
      '', '01.09.2026 00:00:00', '30.09.2026 23:59:59', 'Зарплата', 'Администраторы',
    ]);
    expect([by('налог')[B], by('налог')[C], by('налог')[D], by('налог')[I]]).toEqual(['', '01.08.2026 00:00:00', '31.08.2026 23:59:59', 'Налоги']);
    expect([by('ндс')[B], by('ндс')[C], by('ндс')[D]]).toEqual(['', '01.02.2026 00:00:00', '28.02.2026 23:59:59']);
    expect([by('зарплата, середина месяца')[B], by('зарплата, середина месяца')[C]]).toEqual(['46280', '']);
    expect([by('аренда')[B], by('аренда')[C], by('аренда')[D]]).toEqual(['46266', '', '']);
  });

  it('текст, похожий на формулу, — со стилем quotePrefix и в общих строках; комментарий длиннее 1 000 знаков пишется целиком (Review Focus 4)', async () => {
    w = await opsWorld();
    const long = `${'д'.repeat(1500)}\r\n вторая строка`;
    await op({ paidAt: '2026-10-02T10:00:00Z', comment: '=HYPERLINK("http://evil","x")' });
    await op({ paidAt: '2026-10-03T10:00:00Z', comment: '+7 777 123' });
    await op({ paidAt: '2026-10-04T10:00:00Z', comment: '@SUM(A1)' });
    await op({ paidAt: '2026-10-05T10:00:00Z', comment: '-скидка' });
    await op({ paidAt: '2026-10-05T11:00:00Z', comment: 'обычный' });
    await op({ paidAt: '2026-10-05T12:00:00Z', comment: long });
    const res = await download();
    const xml = sheetOf(res.rawPayload);
    expect(xml).not.toContain('<f>');
    // колонка P — комментарий; строки журнала — по убыванию даты
    const styleOf = (ref: string) => new RegExp(`<c r="${ref}" t="s"( s="7")?>`).exec(xml)?.[1] ?? '';
    expect(styleOf('P2')).toBe(''); // длинный и обычный — без стиля
    expect(styleOf('P3')).toBe('');
    expect(styleOf('P4')).toBe(' s="7"'); // -скидка
    expect(styleOf('P5')).toBe(' s="7"'); // @SUM
    expect(styleOf('P6')).toBe(' s="7"'); // +7
    expect(styleOf('P7')).toBe(' s="7"'); // =HYPERLINK
    expect(sheetRows(res.rawPayload)[1]![P]).toBe(long); // полностью, с CR LF
    const zip = new AdmZip(res.rawPayload);
    expect(zip.getEntry('xl/sharedStrings.xml')!.getData().toString('utf8')).toContain('=HYPERLINK(&quot;http://evil&quot;,&quot;x&quot;)');
    // стиль 7 — quotePrefix; книга с bookViews (без неё старые версии Excel ругаются на файл)
    expect(zip.getEntry('xl/styles.xml')!.getData().toString('utf8')).toContain('quotePrefix="1"');
    expect(zip.getEntry('xl/workbook.xml')!.getData().toString('utf8')).toContain('<bookViews><workbookView/></bookViews><sheets>');

    // табуляция и CR в начале (комментарий операции их обрезает — проверяем писатель напрямую), в общих строках тоже
    const raw = buildXlsx(
      { name: 'Лист', columns: [{ header: 'A', width: 5 }], rows: [[{ kind: 'text', value: '\t=1' }], [{ kind: 'text', value: '\r=2' }], [{ kind: 'text', value: 'a=1' }]] },
      { strings: 'shared' },
    );
    const sheet = new AdmZip(raw).getEntry('xl/worksheets/sheet1.xml')!.getData().toString('utf8');
    expect(sheet).toContain('<c r="A2" t="s" s="7">');
    expect(sheet).toContain('<c r="A3" t="s" s="7">');
    expect(sheet).toContain('<c r="A4" t="s"><v>');
  });

  it('тот же фильтр, что у журнала, и сортировка; format=finmap — то же, что без format; чужая компания — 404; ошибка фильтра и формата — 400', async () => {
    w = await opsWorld();
    await op({ paidAt: '2026-10-02T10:00:00Z', amount: 300 });
    await op({ type: 'income', paidAt: '2026-10-03T10:00:00Z', amount: 200 });
    await op({ paidAt: '2026-10-04T10:00:00Z', amount: 100 });
    const rows = sheetRows((await download('types=expense&sort=amount&order=asc')).rawPayload);
    expect(rows.slice(1).map((r) => [r[E], r[G]])).toEqual([['1.00', 'Касса'], ['3.00', 'Касса']]);
    expect(sheetRows((await download('format=finmap')).rawPayload)).toEqual(sheetRows((await download()).rawPayload));
    expect((await w.h.req('GET', '/api/v1/companies/999999/operations/export.xlsx')).statusCode).toBe(404);
    expect((await w.h.req('GET', exportUrl('from=2026-10-05&to=2026-10-01'))).json().error.code).toBe('VALIDATION');
    expect((await w.h.req('GET', exportUrl('format=csv'))).json().error.code).toBe('VALIDATION');
  });

  it('удалённая операция и операция другой компании в файл не попадают (R5)', async () => {
    w = await opsWorld();
    await op({ paidAt: '2026-10-02T10:00:00Z', comment: 'остаётся' });
    const gone = await op({ paidAt: '2026-10-03T10:00:00Z', comment: 'удалённая' });
    expect((await w.h.req('DELETE', `${w.ops}/${gone}`)).statusCode).toBe(200);
    const other = await w.h.company('Другая');
    const otherAccount = (await w.post(`/api/v1/companies/${other}/accounts`, { name: 'Чужая касса', currency: 'KZT', openedAt: '2026-10-01', startingBalance: 0 })).account.id as number;
    await w.post(`/api/v1/companies/${other}/operations`, { type: 'expense', accountId: otherAccount, amount: 1000, paidAt: '2026-10-04T10:00:00Z', comment: 'чужая' });
    const rows = sheetRows((await download('format=finmap')).rawPayload);
    expect(rows.slice(1).map((r) => r[P])).toEqual(['остаётся']);
  });

  it('имя файла: символы, запрещённые в Windows, в названии компании — «_»', async () => {
    w = await opsWorld();
    expect((await w.h.req('PATCH', `/api/v1/companies/${w.cid}`, { name: 'Клуб "Север": ТОО/ИП?' })).statusCode).toBe(200);
    const res = await download();
    expect(res.headers['content-disposition']).toContain(`filename*=UTF-8''${encodeURIComponent('Клуб _Север__ ТОО_ИП_ - Журнал - 06-10-2026 17-00.xlsx')}`);
  });

  it('больше предела выгрузки — 422 EXPORT_LIMIT, пустой фильтр — книга только с заголовком (Review Focus 5)', async () => {
    w = await opsWorld();
    for (const day of ['02', '03', '04']) await op({ paidAt: `2026-10-${day}T10:00:00Z` });
    const db = w.h.t.db;
    const journal = createJournal({ db, balances: createLedgerBalances(db), timezone: 'Asia/Almaty', exportLimit: 2 });
    const q = { sort: 'date', order: 'desc', format: 'finmap' } as const;
    expect(() => journal.exportXlsx(w.cid, q)).toThrow('Больше 2 операций — сузьте период или фильтр');
    expect(sheetRows(journal.exportXlsx(w.cid, { ...q, from: '2026-10-04' }).data)).toHaveLength(2);
    const empty = sheetRows(journal.exportXlsx(w.cid, { ...q, q: 'нет такого' }).data);
    expect(empty).toEqual([HEADERS]);
  });
});

describe('выгрузка: граница дат (финальные правки 5a)', () => {
  it('to=9999-12-31 — 400 с полем, а не 500', async () => {
    w = await opsWorld();
    const res = await w.h.req('GET', exportUrl('to=9999-12-31'));
    expect(res.statusCode, res.body).toBe(400);
    expect(res.json().error.fields).toEqual({ to: 'Неверная дата' });
  });

  it('xlsx: U+FFFE и U+FFFF вырезаются, CR внутри текста сохраняется как &#13;, неподдерживаемое число знаков — ошибка', () => {
    expect(xmlText('a\uFFFEb\uFFFFc')).toBe('abc');
    expect(xmlText('a\r\nb')).toBe('a&#13;\nb');
    const sheet = { name: 'Л', columns: [{ header: 'A', width: 10 }], rows: [[{ kind: 'number' as const, value: '1.5', decimals: 5 }]] };
    expect(() => buildXlsx(sheet)).toThrow(/знаков/);
  });
});

describe('журнал: «Собрать Excel» — format=custom (§8.3 спецификации импорта)', () => {
  /** Доход с разбиением, перевод KZT → USD по курсу 475,12 (зачисление 1,00 $), расход в USD и зарплата с подкатегорией и периодом. */
  async function mixedWorld() {
    w = await opsWorld();
    const salary = await systemCategory('salary');
    const staff = (await w.post(`/api/v1/companies/${w.cid}/categories`, { kind: 'expense', name: 'Администраторы', parentId: salary })).category.id as number;
    await op({
      type: 'income',
      paidAt: '2026-10-05T05:00:00Z',
      amount: 150050,
      accrualDate: '2026-09-30',
      counterpartyId: w.counterparty,
      tagIds: [w.tag],
      comment: 'доход',
      lines: [
        { categoryId: w.income, projectId: w.project, amount: 100000 },
        { categoryId: w.income, projectId: w.project2, amount: 50050 },
      ],
    });
    await op({ type: 'transfer', paidAt: '2026-10-04T10:00:00Z', amount: 47512, toAccountId: w.usd, toAmount: 100, comment: 'перевод', lines: [] });
    await op({ paidAt: '2026-10-03T10:00:00Z', accountId: w.usd, amount: 100, comment: 'расход', lines: [{ categoryId: w.expense, projectId: null, amount: 100 }] });
    await op({ paidAt: '2026-10-02T10:00:00Z', accrualDate: '2026-09-01', amount: 1000, comment: 'зарплата', lines: [{ categoryId: staff, projectId: null, amount: 1000 }] });
  }
  const custom = (columns: string[], qs = '') => download(`format=custom&${columns.map((c) => `columns=${c}`).join('&')}${qs ? `&${qs}` : ''}`);

  it('колонки — в заданном порядке, заголовки Finmap без звёздочек, лист «Журнал»; одна строка на операцию; суммы со знаком; «; » у разбитой', async () => {
    await mixedWorld();
    const columns = ['amount', 'type', 'paidAt', 'category', 'subcategory', 'project', 'fromAccount', 'toAccount', 'baseAmount', 'periodFrom', 'accrualDate', 'comment'];
    const res = await custom(columns);
    expect(res.headers['content-disposition']).toContain(encodeURIComponent('ТОО - Журнал - 06-10-2026 17-00.xlsx'));
    expect(new AdmZip(res.rawPayload).getEntry('xl/workbook.xml')!.getData().toString('utf8')).toContain('<sheet name="Журнал" sheetId="1" r:id="rId1"/>');
    const rows = sheetRows(res.rawPayload);
    expect(rows[0]).toEqual([
      'Сумма в валюте счета', 'Тип', 'Дата платежа', 'Категория', 'Подкатегория', 'Проект', 'Со счета', 'На счет', 'Сумма в валюте компании',
      'Период начисления (дата "с")', 'Дата начисления', 'Комментарий',
    ]);
    const [, income, transfer, expense, salary] = rows as [string[], string[], string[], string[], string[], string[]];
    // доход: одна строка, проекты и категории строк — через «; » без повторов; знак «плюс» не пишется
    expect([income[0], income[1], income[3], income[4], income[5], income[6], income[7], income[8], income[11]]).toEqual(['1500.50', 'Доход', 'Бар', '', 'Клуб 1; Клуб 2', '', 'Касса', '1500.50', 'доход']);
    expect([income[9], income[10]]).toEqual(['', '46295']);
    // перевод — без знака; расход — со знаком «минус» и в валюте счёта, и в валюте компании
    expect([transfer[0], transfer[1], transfer[6], transfer[7], transfer[8]]).toEqual(['475.12', 'Перевод', 'Касса', 'Валютный', '475.12']);
    expect([expense[0], expense[1], expense[6], expense[7], expense[8]]).toEqual(['-1.00', 'Расход', 'Валютный', '', '-475.12']);
    // зарплата: категория и подкатегория; «Дата начисления» пишется всегда, период — по правилу §8.2 (у Finmap заполнены и дата, и период)
    expect([salary[3], salary[4], salary[9], salary[10]]).toEqual(['Зарплата', 'Администраторы', '01.09.2026 00:00:00', '46266']);
    expect(rows).toHaveLength(6); // заголовок + 4 операции + «Итого»
  });

  it('«Итого»: сумма в валюте компании со знаком; в валюте счёта — только при одной валюте; подпись — в первой колонке без суммы; значения — не формулы', async () => {
    await mixedWorld();
    // разные валюты счетов: сумма в валюте компании есть, в валюте счёта нет — подпись в колонке «Сумма в валюте счета»
    const mixed = await custom(['amount', 'baseAmount']);
    const mixedRows = sheetRows(mixed.rawPayload);
    // 1500,50 + 475,12 (перевод без знака) - 475,12 - 10,00
    expect(mixedRows.at(-1)).toEqual(['Итого', '1490.50']);
    const xml = sheetOf(mixed.rawPayload);
    expect(xml).not.toContain('<f>');
    // полужирным: подпись — стиль заголовка 1, число с двумя знаками — полужирный формат 9
    expect(xml).toMatch(/<c r="A6" t="s" s="1">/);
    expect(xml).toMatch(/<c r="B6" s="9"><v>1490\.50<\/v><\/c>/);
    // только KZT: итог есть у обеих сумм, подписи нет (все колонки заняты итогами)
    const kzt = sheetRows((await custom(['amount', 'baseAmount'], `types=income&types=expense&accountIds=${w.kzt}`)).rawPayload);
    expect(kzt.at(-1)).toEqual(['1490.50', '1490.50']);
    // переводы: «Сумма зачисления» суммируется при одной валюте зачисления; подпись — в соседней колонке
    const transfers = sheetRows((await custom(['toAmount', 'toCurrency'], 'types=transfer')).rawPayload);
    expect(transfers).toEqual([['Сумма зачисления', 'Валюта зачисления'], ['1.00', 'USD'], ['1.00', 'Итого']]);
    // без операций — только заголовок, строки «Итого» нет
    expect(sheetRows((await custom(['amount'], 'q=нет такого')).rawPayload)).toEqual([['Сумма в валюте счета']]);
  });

  it('«Остатки и валюты»: валюта счёта, остаток после операции, сумма, валюта и остаток зачисления — по истории счетов', async () => {
    await mixedWorld();
    const rows = sheetRows((await custom(['balanceAfter', 'toBalanceAfter', 'currency', 'toAmount', 'toCurrency'])).rawPayload);
    expect(rows.slice(1, 5)).toEqual([
      ['1015.38', '', 'KZT', '', ''], // доход: -10,00 - 475,12 + 1500,50
      ['-485.12', '0.00', 'KZT', '1.00', 'USD'], // перевод: остаток Кассы и остаток «Валютного» после зачисления
      ['-1.00', '', 'USD', '', ''],
      ['-10.00', '', 'KZT', '', ''],
    ]);
  });

  it('ошибки запроса: нет колонок, неизвестная, повтор; id проверяется и у format=finmap, но колонки на его файл не влияют (Review Focus 5)', async () => {
    w = await opsWorld();
    const error = async (qs: string) => (await w.h.req('GET', exportUrl(qs))).json().error;
    expect((await error('format=custom')).fields).toEqual({ columns: 'Выберите хотя бы одну колонку' });
    expect((await error('format=custom&columns=')).fields).toEqual({ columns: 'Выберите хотя бы одну колонку' });
    expect((await error('format=custom&columns=amount&columns=nope')).fields).toEqual({ 'columns.1': 'Неизвестная колонка' });
    expect((await error('format=custom&columns=amount&columns=amount')).fields).toEqual({ columns: 'Колонки не должны повторяться' });
    expect((await w.h.req('GET', exportUrl('format=finmap&columns=nope'))).statusCode).toBe(400);
    const fine = await w.h.req('GET', exportUrl('format=finmap&columns=amount'));
    expect(sheetRows(fine.rawPayload)[0]).toHaveLength(16);
  });

  it('превью: первые 3 операции фильтра, текст каждой колонки каталога — как в файле; фильтр применяется; чужая компания — 404', async () => {
    await mixedWorld();
    const res = await w.h.req('GET', `${w.ops}/export-preview`);
    expect(res.statusCode, res.body).toBe(200);
    const { rows } = res.json() as { rows: Record<string, string>[] };
    expect(rows).toHaveLength(3); // операций четыре
    expect(Object.keys(rows[0]!).sort()).toEqual(
      [
        'paidAt', 'accrualDate', 'periodFrom', 'periodTo', 'amount', 'baseAmount', 'type', 'fromAccount', 'toAccount', 'category', 'subcategory',
        'counterparty', 'project', 'tags', 'comment', 'currency', 'balanceAfter', 'toAmount', 'toCurrency', 'toBalanceAfter',
      ].sort(),
    );
    expect(rows[0]).toMatchObject({
      paidAt: '05.10.2026 10:00',
      accrualDate: '30.09.2026',
      amount: '1\u202F500,50',
      baseAmount: '1\u202F500,50',
      type: 'Доход',
      toAccount: 'Касса',
      category: 'Бар',
      project: 'Клуб 1; Клуб 2',
      counterparty: 'ИП Клиент',
      tags: 'Смена',
      currency: 'KZT',
      balanceAfter: '1\u202F015,38',
    });
    expect(rows[2]).toMatchObject({ amount: '\u22121,00', baseAmount: '\u2212475,12', currency: 'USD', balanceAfter: '\u22121,00' });
    const expenses = ((await w.h.req('GET', `${w.ops}/export-preview?types=expense`)).json() as { rows: Record<string, string>[] }).rows;
    expect(expenses.map((r) => r.comment)).toEqual(['расход', 'зарплата']);
    expect(expenses[1]).toMatchObject({ periodFrom: '01.09.2026 00:00:00', periodTo: '30.09.2026 23:59:59', subcategory: 'Администраторы' });
    expect((await w.h.req('GET', '/api/v1/companies/999999/operations/export-preview')).statusCode).toBe(404);
    expect((await w.h.req('GET', `${w.ops}/export-preview?from=2026-10-05&to=2026-10-01`)).json().error.code).toBe('VALIDATION');
  });

  it('превью: операция, удалённая через DELETE, в строках не появляется (R5)', async () => {
    await mixedWorld();
    const before = ((await w.h.req('GET', `${w.ops}/export-preview?types=expense`)).json() as { rows: Record<string, string>[] }).rows;
    expect(before.map((r) => r.comment)).toEqual(['расход', 'зарплата']);
    const list = (await w.h.req('GET', `${w.ops}?types=expense`)).json() as { items: { id: number; comment: string | null }[] };
    const doomed = list.items.find((i) => i.comment === 'расход')!;
    expect((await w.h.req('DELETE', `${w.ops}/${doomed.id}`)).statusCode).toBeLessThan(300);
    const after = ((await w.h.req('GET', `${w.ops}/export-preview?types=expense`)).json() as { rows: Record<string, string>[] }).rows;
    expect(after.map((r) => r.comment)).toEqual(['зарплата']);
  });

  it('писатель: полужирные ячейки — подпись стилем заголовка, числа — полужирными форматами с 0, 2 и 3 знаками', () => {
    const raw = buildXlsx({
      name: 'Итог',
      columns: [{ header: 'A', width: 5 }],
      rows: [
        [{ kind: 'text', value: 'Итого', bold: true }],
        [{ kind: 'number', value: '1', decimals: 0, bold: true }],
        [{ kind: 'number', value: '1.50', decimals: 2, bold: true }],
        [{ kind: 'number', value: '1.500', decimals: 3, bold: true }],
        [{ kind: 'number', value: '1.50', decimals: 2 }],
      ],
    });
    const zip = new AdmZip(raw);
    const xml = zip.getEntry('xl/worksheets/sheet1.xml')!.getData().toString('utf8');
    expect(xml).toContain('<c r="A2" t="inlineStr" s="1">');
    expect(['A3" s="8', 'A4" s="9', 'A5" s="10', 'A6" s="5'].every((x) => xml.includes(`<c r="${x}">`))).toBe(true);
    expect(zip.getEntry('xl/styles.xml')!.getData().toString('utf8')).toContain('<cellXfs count="11">');
  });
});
