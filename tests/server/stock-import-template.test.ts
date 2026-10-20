import AdmZip from 'adm-zip';
import { afterEach, describe, expect, it } from 'vitest';
import { excelDate } from '../../src/server/modules/operations/journal-export';
import { stockTemplateSheets } from '../../src/server/modules/stock/import-template';
import { createApi } from '../helpers/api';
import { stockWorld, type StockWorld } from '../helpers/stock';
import { ORIGIN_HEADERS } from '../helpers/test-app';
import { sheetRows } from '../helpers/xlsx-rows';

let w: StockWorld | undefined;
let extra: { t: { cleanup(): Promise<void> } } | undefined;
afterEach(async () => {
  await w?.h.t.cleanup();
  await extra?.t.cleanup();
  w = undefined;
  extra = undefined;
});

/** «Сейчас» — 2026-10-06 12:00 UTC: «вчера» по Алматы — 05.10.2026. */
const TODAY = '2026-10-06';

/** Мир склада с группой «Напитки», комплектом, архивным товаром и архивным поставщиком (Review Focus 5). */
async function world(): Promise<StockWorld> {
  w = await stockWorld();
  await w.post(`${w.stock}/groups`, { name: 'Напитки' });
  await w.combo('Чипсы + кола', [
    [w.chips, 1000],
    [w.cola, 1000],
  ]);
  expect((await w.h.req('POST', `${w.stock}/items/${w.syrup}/archive`)).statusCode).toBe(200);
  const old = (await w.post(`/api/v1/companies/${w.cid}/counterparties`, { type: 'supplier', name: 'Поставщик Б' })).counterparty.id as number;
  expect((await w.h.req('POST', `/api/v1/companies/${w.cid}/counterparties/${old}/archive`)).statusCode).toBe(200);
  return w;
}

const download = async (s: StockWorld, kind: string) => s.h.t.app.inject({ method: 'GET', url: `${s.stock}/import/${kind}/template.xlsx`, headers: { cookie: s.h.cookie } });
const upload = (s: StockWorld, kind: 'items' | 'receipts', data: Buffer, query: string) =>
  s.h.t.app.inject({
    method: 'POST',
    url: `${s.stock}/import/${kind}?${query}`,
    headers: { ...ORIGIN_HEADERS, cookie: s.h.cookie, 'content-type': 'application/octet-stream', 'x-file-name': encodeURIComponent('шаблон.xlsx') },
    payload: data,
  });
/** Атрибуты и текст элементов <dataValidation> листа. */
function validations(xml: string): { sqref: string; formula: string; attrs: Record<string, string> }[] {
  return [...xml.matchAll(/<dataValidation ([^>]*)><formula1>([^<]*)<\/formula1><\/dataValidation>/g)].map((m) => {
    const attrs = Object.fromEntries([...m[1]!.matchAll(/(\w+)="([^"]*)"/g)].map((a) => [a[1]!, a[2]!]));
    return { sqref: attrs.sqref!, formula: m[2]!, attrs };
  });
}
const sheetsOf = (zip: AdmZip) => [...zip.getEntry('xl/workbook.xml')!.getData().toString('utf8').matchAll(/<sheet ([^>]*)\/>/g)].map((m) => m[1]!);
/** Текстовые значения столбца листа «Списки» (без заголовка). */
const listColumn = (rows: ({ kind: string; value: unknown } | null)[][], col: number) => rows.map((r) => r[col]).filter((c) => c !== null && c !== undefined).map((c) => c!.value);

describe('шаблоны импорта склада (спецификация 2026-10-19, часть 4; план 2026-10-20, задача 6)', () => {
  it('шаблон каталога: заголовки и примеры, «Как заполнять», скрытые «Списки», выпадающие «Группа» и «Единица»', async () => {
    const s = await world();
    const res = await download(s, 'items');
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toBe('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    expect(decodeURIComponent(String(res.headers['content-disposition']))).toContain('Шаблон товаров.xlsx');
    const data = res.rawPayload;
    expect(sheetRows(data)).toEqual([
      ['Название', 'Группа', 'Единица', 'Штрихкод', 'Цена продажи'],
      ['Кола 0,5', 'Напитки', 'шт', '', '350'],
      ['Чипсы', 'Снеки', 'шт', '', '400'],
    ]);
    const zip = new AdmZip(data);
    const sheets = sheetsOf(zip);
    expect(sheets.map((a) => /name="([^"]*)"/.exec(a)![1])).toEqual(['Товары', 'Как заполнять', 'Списки']);
    expect(sheets.map((a) => a.includes('state="hidden"'))).toEqual([false, false, true]);
    // выпадающие списки в файле (R13): информационное предупреждение — новое значение вписать можно
    const v = validations(zip.getEntry('xl/worksheets/sheet1.xml')!.getData().toString('utf8'));
    expect(v.map((x) => [x.sqref, x.formula])).toEqual([
      ['B2:B5001', "'Списки'!$A$2:$A$2"],
      ['C2:C5001', "'Списки'!$B$2:$B$5"],
    ]);
    expect(v[0]!.attrs).toMatchObject({ type: 'list', errorStyle: 'information', allowBlank: '1', showErrorMessage: '1', errorTitle: 'Нет в списке' });
    expect(v[0]!.attrs.error).toBe('Такого значения нет в списке — при импорте оно будет создано');
    // «Единица» — только из списка: других единиц импорт не знает
    expect(v[1]!.attrs).toMatchObject({ type: 'list', errorStyle: 'stop', error: 'Выберите значение из списка' });

    const book = await stockTemplateSheets(s.h.t.db, s.cid, 'items', TODAY);
    expect(book.map((x) => x.name)).toEqual(['Товары', 'Как заполнять', 'Списки']);
    expect(book[1]!.columns.map((c) => c.header)).toEqual(['Правила']);
    expect(book[1]!.rows[0]).toEqual([{ kind: 'text', value: 'Заполняйте первый лист «Товары». Строки 2–3 — примеры: замените или удалите их.' }]);
    const lists = book[2]!;
    expect(lists.hidden).toBe(true);
    expect(lists.columns.map((c) => c.header)).toEqual(['Группа', 'Единица']);
    expect(listColumn(lists.rows, 0)).toEqual(['Напитки']);
    expect(listColumn(lists.rows, 1)).toEqual(['шт', 'л', 'кг', 'уп']);
  });

  it('шаблон поступлений: вчерашняя дата в примерах, «Товар» без комплектов и архива, «Поставщик» без архива', async () => {
    const s = await world();
    const res = await download(s, 'receipts');
    expect(res.statusCode).toBe(200);
    expect(decodeURIComponent(String(res.headers['content-disposition']))).toContain('Шаблон поступлений.xlsx');
    const rows = sheetRows(res.rawPayload);
    expect(rows[0]).toEqual(['Дата', 'Поставщик', 'Товар', 'Количество', 'Сумма', 'Цена']);
    // «сегодня» сервиса — по APP_TIMEZONE: пример — вчерашней датой
    expect(rows[1]![0]).toBe(String(excelDate('2026-10-05')));
    const book = await stockTemplateSheets(s.h.t.db, s.cid, 'receipts', TODAY);
    expect(book.map((x) => x.name)).toEqual(['Поступления', 'Как заполнять', 'Списки']);
    const [first, second] = book[0]!.rows;
    expect(first![0]).toEqual({ kind: 'date', value: excelDate('2026-10-05') });
    expect(first!.slice(1, 3)).toEqual([
      { kind: 'text', value: 'Поставщик А' },
      { kind: 'text', value: 'Кола 0,5' },
    ]);
    expect(second![2]).toEqual({ kind: 'text', value: 'Чипсы' });
    const lists = book[2]!;
    expect(lists.columns.map((c) => c.header)).toEqual(['Товар', 'Поставщик']);
    expect(listColumn(lists.rows, 0)).toEqual(['Кола 0,5', 'Чипсы']);
    expect(listColumn(lists.rows, 1)).toEqual(['Поставщик А']);
    expect(book[0]!.validations).toEqual([
      { column: 2, fromRow: 2, toRow: 5001, source: "'Списки'!$A$2:$A$3" },
      { column: 1, fromRow: 2, toRow: 5001, source: "'Списки'!$B$2:$B$2" },
    ]);
  });

  it('скачанный шаблон проходит проверку импорта без ошибок (Review Focus 5)', async () => {
    const s = await world();
    const items = await upload(s, 'items', (await download(s, 'items')).rawPayload, 'commit=0');
    expect(items.statusCode, items.body).toBe(200);
    expect(items.json()).toMatchObject({ rows: 2, errorsTotal: 0 });
    const receipts = await upload(s, 'receipts', (await download(s, 'receipts')).rawPayload, `warehouse=${s.wh}&commit=0`);
    expect(receipts.statusCode, receipts.body).toBe(200);
    expect(receipts.json()).toMatchObject({ rows: 2, errorsTotal: 0 });
  });

  it('пустые справочники: выпадающего списка нет только у пустых столбцов; проверка импорта — без ошибок', async () => {
    const h = await createApi('2026-10-06T12:00:00.000Z');
    extra = h;
    const cid = await h.company('ТОО Пустая');
    const project = (await h.req('POST', `/api/v1/companies/${cid}/projects`, { name: 'Клуб 1', templateKey: 'general' })).json().project.id as number;
    const wh = (await h.req('POST', `/api/v1/companies/${cid}/stock/warehouses`, { projectId: project, name: 'Бар Клуб 1' })).json().warehouse.id as number;
    const empty = { h, cid, stock: `/api/v1/companies/${cid}/stock`, wh } as unknown as StockWorld;
    const items = await stockTemplateSheets(h.t.db, cid, 'items', TODAY);
    expect(items[0]!.validations).toEqual([{ column: 2, fromRow: 2, toRow: 5001, source: "'Списки'!$B$2:$B$5", strict: true }]);
    expect((await stockTemplateSheets(h.t.db, cid, 'receipts', TODAY))[0]!.validations).toEqual([]);
    for (const [kind, query] of [
      ['items', 'commit=0'],
      ['receipts', `warehouse=${wh}&commit=0`],
    ] as const) {
      const file = await download(empty, kind);
      expect(file.statusCode).toBe(200);
      const check = await upload(empty, kind, file.rawPayload, query);
      expect(check.statusCode, check.body).toBe(200);
      expect(check.json().errorsTotal).toBe(0);
    }
  });

  it('неизвестный вид — 404; несуществующая компания — 404; поставщики по ключу имени без повторов', async () => {
    const s = await world();
    expect((await download(s, 'stocks')).statusCode).toBe(404);
    const res = await s.h.t.app.inject({ method: 'GET', url: `/api/v1/companies/${s.cid + 1000}/stock/import/items/template.xlsx`, headers: { cookie: s.h.cookie } });
    expect(res.statusCode).toBe(404);
    await s.post(`/api/v1/companies/${s.cid}/counterparties`, { type: 'supplier', name: 'поставщик а' });
    await s.post(`/api/v1/companies/${s.cid}/counterparties`, { type: 'supplier', name: 'Алма' });
    const lists = (await stockTemplateSheets(s.h.t.db, s.cid, 'receipts', TODAY))[2]!;
    expect(listColumn(lists.rows, 1)).toEqual(['Алма', 'Поставщик А']);
  });
});
