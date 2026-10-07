import AdmZip from 'adm-zip';
import { afterEach, describe, expect, it } from 'vitest';
import { createLedgerBalances } from '../../src/server/modules/balances/service';
import { createJournal } from '../../src/server/modules/operations/journal';
import { excelDate, excelDateTime, minorToDecimal } from '../../src/server/modules/operations/journal-export';
import { buildXlsx, columnName, xmlText } from '../../src/server/http/xlsx';
import { opsWorld, type OpsWorld } from '../helpers/ops';

let w: OpsWorld;
afterEach(async () => w?.h.t.cleanup());

const op = async (body: Record<string, unknown>) =>
  (await w.post(w.ops, { type: 'expense', accountId: w.kzt, amount: 1000, ...body })).operation.id as number;
const exportUrl = (qs = '') => `${w.ops}/export.xlsx${qs ? `?${qs}` : ''}`;
const sheetOf = (body: Buffer) => new AdmZip(body).getEntry('xl/worksheets/sheet1.xml')!.getData().toString('utf8');

describe('журнал: выгрузка в Excel (§7)', () => {
  it('вспомогательные: суммы — точной десятичной записью, даты Excel по часам Алматы, буквы столбцов, текст для XML', () => {
    expect(minorToDecimal(150050, 2)).toBe('1500.50');
    expect(minorToDecimal(-5, 2)).toBe('-0.05');
    expect(minorToDecimal(30, 2)).toBe('0.30');
    expect(minorToDecimal(1234, 0)).toBe('1234');
    expect(minorToDecimal(-1234567, 3)).toBe('-1234.567');
    expect(excelDate('2026-10-05')).toBe(46300);
    expect(excelDateTime('2026-10-05T05:00:00.000Z', 'Asia/Almaty')).toBeCloseTo(46300 + 10 / 24, 9); // 10:00 по Алматы
    expect(excelDateTime('2026-10-04T19:30:00.000Z', 'Asia/Almaty')).toBeCloseTo(46300 + 0.5 / 24, 9); // 00:30 следующего дня
    expect([0, 25, 26, 27, 701, 702].map(columnName)).toEqual(['A', 'Z', 'AA', 'AB', 'ZZ', 'AAA']);
    expect(xmlText('<b>&"\u0007\uD800ok\u{1F389}')).toBe('&lt;b&gt;&amp;&quot;ok\u{1F389}');
  });

  it('файл XLSX: части пакета, заголовки, числа и даты с форматом, остатки, разбиения, экранирование; имя файла по RFC 8187 (Review Focus 5)', async () => {
    w = await opsWorld();
    await op({
      type: 'income',
      paidAt: '2026-10-05T05:00:00Z',
      amount: 150050,
      accrualDate: '2026-09-30',
      counterpartyId: w.counterparty,
      tagIds: [w.tag],
      comment: '<b>Тест & "кавычки"</b>\u0007 \u{1F389}',
      lines: [
        { categoryId: w.income, projectId: w.project, amount: 100000 },
        { categoryId: w.income, projectId: w.project2, amount: 50050 },
      ],
    });
    await op({ type: 'transfer', paidAt: '2026-10-04T10:00:00Z', amount: 47512, toAccountId: w.usd, toAmount: 100 });
    await op({ paidAt: '2026-10-03T10:00:00Z', accountId: w.usd, amount: 100 });

    const res = await w.h.req('GET', exportUrl());
    expect(res.statusCode, res.body).toBe(200);
    expect(res.headers['content-type']).toBe('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    expect(res.headers['content-disposition']).toBe(
      `attachment; filename="________ ___ 2026-10-06.xlsx"; filename*=UTF-8''${encodeURIComponent('Операции ТОО 2026-10-06.xlsx')}`,
    );
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['cache-control']).toBe('private, no-store');

    const zip = new AdmZip(res.rawPayload);
    expect(zip.getEntries().map((e) => e.entryName).sort()).toEqual(
      ['[Content_Types].xml', '_rels/.rels', 'xl/_rels/workbook.xml.rels', 'xl/styles.xml', 'xl/workbook.xml', 'xl/worksheets/sheet1.xml'].sort(),
    );
    expect(zip.getEntry('xl/workbook.xml')!.getData().toString('utf8')).toContain('<sheet name="Операции" sheetId="1" r:id="rId1"/>');
    expect(zip.getEntry('[Content_Types].xml')!.getData().toString('utf8')).toContain('/xl/worksheets/sheet1.xml');

    const xml = sheetOf(res.rawPayload);
    expect(xml.match(/<row /g)).toHaveLength(4); // заголовок + 3 операции, новые сверху
    expect(xml).toContain('<c r="A1" t="inlineStr" s="1"><is><t xml:space="preserve">Дата</t></is></c>');
    expect(xml).toContain('<t xml:space="preserve">Сумма, KZT</t>');
    expect(xml).toContain('<t xml:space="preserve">Остаток зачисления</t>');
    // доход 1500,50 ₸: дата и время, суммы, остаток после (\u2212475,12 + 1500,50), статья без повтора, проекты и тег, дата сделки
    expect(xml).toMatch(/<c r="A2" s="2"><v>46300\.41666/);
    expect(xml).toContain('<c r="B2" t="inlineStr"><is><t xml:space="preserve">Доход</t></is></c>');
    expect(xml).toContain('<c r="C2" s="5"><v>1500.50</v></c>');
    expect(xml).toContain('<c r="E2" s="5"><v>1500.50</v></c>');
    expect(xml).toContain('<c r="G2" s="5"><v>1025.38</v></c>');
    expect(xml).toContain('<c r="K2" t="inlineStr"><is><t xml:space="preserve">ИП Клиент</t></is></c>');
    expect(xml).toContain('<c r="L2" t="inlineStr"><is><t xml:space="preserve">Бар</t></is></c>');
    expect(xml).toContain('<c r="M2" t="inlineStr"><is><t xml:space="preserve">Клуб 1; Клуб 2</t></is></c>');
    expect(xml).toContain('<c r="N2" t="inlineStr"><is><t xml:space="preserve">Смена</t></is></c>');
    expect(xml).toContain('<t xml:space="preserve">&lt;b&gt;Тест &amp; &quot;кавычки&quot;&lt;/b&gt; \u{1F389}</t>');
    expect(xml).toContain('<c r="P2" s="3"><v>46295</v></c>');
    expect(xml).not.toContain('\u0007');
    // перевод: без знака, счёт и сумма зачисления, оба остатка
    expect(xml).toContain('<c r="C3" s="5"><v>475.12</v></c>');
    expect(xml).toContain('<c r="G3" s="5"><v>-475.12</v></c>');
    expect(xml).toContain('<c r="H3" t="inlineStr"><is><t xml:space="preserve">Валютный</t></is></c>');
    expect(xml).toContain('<c r="I3" s="5"><v>1.00</v></c>');
    expect(xml).toContain('<c r="J3" s="5"><v>0.00</v></c>');
    // расход в USD: минус в валюте счёта и в базовой
    expect(xml).toContain('<c r="C4" s="5"><v>-1.00</v></c>');
    expect(xml).toContain('<c r="D4" t="inlineStr"><is><t xml:space="preserve">USD</t></is></c>');
    expect(xml).toContain('<c r="E4" s="5"><v>-475.12</v></c>');
    expect(xml).not.toContain('<c r="H4"'); // пустые ячейки не пишутся
  });

  it('текст, похожий на формулу (=, +, -, @, табуляция, CR в начале), — строка со стилем quotePrefix; формул в книге нет (Review Focus 5)', async () => {
    w = await opsWorld();
    await op({ paidAt: '2026-10-02T10:00:00Z', comment: '=HYPERLINK("http://evil","x")' });
    await op({ paidAt: '2026-10-03T10:00:00Z', comment: '+7 777 123' });
    await op({ paidAt: '2026-10-04T10:00:00Z', comment: '@SUM(A1)' });
    await op({ paidAt: '2026-10-05T10:00:00Z', comment: '-скидка' });
    await op({ paidAt: '2026-10-05T11:00:00Z', comment: 'обычный' });
    const zip = new AdmZip((await w.h.req('GET', exportUrl())).rawPayload);
    const xml = zip.getEntry('xl/worksheets/sheet1.xml')!.getData().toString('utf8');
    expect(xml).not.toContain('<f>');
    expect(xml).toContain('<c r="O2" t="inlineStr"><is><t xml:space="preserve">обычный</t></is></c>');
    expect(xml).toContain('<c r="O3" t="inlineStr" s="7"><is><t xml:space="preserve">-скидка</t></is></c>');
    expect(xml).toContain('<c r="O4" t="inlineStr" s="7"><is><t xml:space="preserve">@SUM(A1)</t></is></c>');
    expect(xml).toContain('<c r="O5" t="inlineStr" s="7"><is><t xml:space="preserve">+7 777 123</t></is></c>');
    expect(xml).toContain('<c r="O6" t="inlineStr" s="7"><is><t xml:space="preserve">=HYPERLINK(&quot;http://evil&quot;,&quot;x&quot;)</t></is></c>');
    // стиль 7 — quotePrefix; книга с bookViews (без неё старые версии Excel ругаются на файл)
    expect(zip.getEntry('xl/styles.xml')!.getData().toString('utf8')).toContain('<cellXfs count="8">');
    expect(zip.getEntry('xl/styles.xml')!.getData().toString('utf8')).toContain('<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0" quotePrefix="1"/></cellXfs>');
    expect(zip.getEntry('xl/workbook.xml')!.getData().toString('utf8')).toContain('<bookViews><workbookView/></bookViews><sheets>');

    // табуляция и CR в начале (комментарий операции их обрезает — проверяем писатель напрямую)
    const raw = buildXlsx({ name: 'Лист', columns: [{ header: 'A', width: 5 }], rows: [[{ kind: 'text', value: '\t=1' }], [{ kind: 'text', value: '\r=2' }], [{ kind: 'text', value: 'a=1' }]] });
    const sheet = new AdmZip(raw).getEntry('xl/worksheets/sheet1.xml')!.getData().toString('utf8');
    expect(sheet).toContain('<c r="A2" t="inlineStr" s="7">');
    expect(sheet).toContain('<c r="A3" t="inlineStr" s="7">');
    expect(sheet).toContain('<c r="A4" t="inlineStr"><is>');
  });

  it('тот же фильтр, что у журнала, и сортировка; чужая компания — 404; ошибка фильтра — 400', async () => {
    w = await opsWorld();
    await op({ paidAt: '2026-10-02T10:00:00Z', amount: 300 });
    await op({ type: 'income', paidAt: '2026-10-03T10:00:00Z', amount: 200 });
    await op({ paidAt: '2026-10-04T10:00:00Z', amount: 100 });
    const xml = sheetOf((await w.h.req('GET', exportUrl('types=expense&sort=amount&order=asc'))).rawPayload);
    expect(xml.match(/<row /g)).toHaveLength(3);
    expect(xml).toContain('<c r="C2" s="5"><v>-1.00</v></c>');
    expect(xml).toContain('<c r="C3" s="5"><v>-3.00</v></c>');
    expect((await w.h.req('GET', '/api/v1/companies/999999/operations/export.xlsx')).statusCode).toBe(404);
    expect((await w.h.req('GET', exportUrl('from=2026-10-05&to=2026-10-01'))).json().error.code).toBe('VALIDATION');
  });

  it('больше предела выгрузки — 422 EXPORT_LIMIT, пустой фильтр — книга только с заголовком', async () => {
    w = await opsWorld();
    for (const day of ['02', '03', '04']) await op({ paidAt: `2026-10-${day}T10:00:00Z` });
    const db = w.h.t.db;
    const journal = createJournal({ db, balances: createLedgerBalances(db), timezone: 'Asia/Almaty', exportLimit: 2 });
    const q = { sort: 'date', order: 'desc' } as const;
    expect(() => journal.exportXlsx(w.cid, q)).toThrow('Больше 2 операций — сузьте период или фильтр');
    expect(sheetOf(journal.exportXlsx(w.cid, { ...q, from: '2026-10-04' }).data).match(/<row /g)).toHaveLength(2);
    expect(sheetOf(journal.exportXlsx(w.cid, { ...q, q: 'нет такого' }).data).match(/<row /g)).toHaveLength(1);
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
    expect(xmlText('a￾b￿c')).toBe('abc');
    expect(xmlText('a\r\nb')).toBe('a&#13;\nb');
    const sheet = { name: 'Л', columns: [{ header: 'A', width: 10 }], rows: [[{ kind: 'number' as const, value: '1.5', decimals: 5 }]] };
    expect(() => buildXlsx(sheet)).toThrow(/знаков/);
  });
});
