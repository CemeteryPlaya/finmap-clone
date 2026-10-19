import { afterEach, describe, expect, it } from 'vitest';
import { buildXlsx, type XlsxCell } from '../../src/server/http/xlsx';
import { finmapLikeXlsx } from '../helpers/finmap-like';
import { stockWorld, type StockWorld } from '../helpers/stock';
import { ORIGIN_HEADERS } from '../helpers/test-app';

let w: StockWorld | null = null;
afterEach(async () => {
  await w?.h.t.cleanup();
  w = null;
});

async function world(): Promise<StockWorld> {
  w = await stockWorld('2026-10-06T12:00:00.000Z');
  return w;
}

type Value = string | number | null;
const cell = (v: Value): XlsxCell => (v === null ? null : typeof v === 'number' ? { kind: 'number', value: String(v), decimals: 2 } : { kind: 'text', value: v });
/** Книга с одним листом: первая строка — заголовки. */
const xlsx = (headers: string[], rows: Value[][]) =>
  buildXlsx({ name: 'Лист1', columns: headers.map((header) => ({ header, width: 12 })), rows: rows.map((r) => r.map(cell)) });

/** cp1251 для кириллицы и ASCII — так сохраняет CSV русский Excel. */
function cp1251(text: string): Buffer {
  return Buffer.from(
    [...text].map((ch) => {
      const c = ch.codePointAt(0)!;
      if (c < 0x80) return c;
      if (c >= 0x410 && c <= 0x44f) return c - 0x410 + 0xc0;
      if (c === 0x401) return 0xa8;
      if (c === 0x451) return 0xb8;
      throw new Error(`нет в cp1251: ${ch}`);
    }),
  );
}

async function upload(world: StockWorld, kind: 'items' | 'receipts', data: Buffer, query: string, name = 'склад.xlsx') {
  return world.h.t.app.inject({
    method: 'POST',
    url: `${world.stock}/import/${kind}?${query}`,
    headers: { ...ORIGIN_HEADERS, cookie: world.h.cookie, 'content-type': 'application/octet-stream', 'x-file-name': encodeURIComponent(name) },
    payload: data,
  });
}

const count = (world: StockWorld, sql: string, ...args: unknown[]) => (world.h.t.sqlite.prepare(sql).get(...args) as { n: number }).n;
const CATALOG = ['Название', 'Группа', 'Единица', 'Штрихкод', 'Цена продажи'];
const RECEIPTS = ['Дата', 'Поставщик', 'Товар', 'Количество', 'Сумма', 'Цена'];

describe('импорт каталога (§9.1, Склад-2)', () => {
  it('проверка ничего не пишет; запись создаёт товары и группы, «Кола 0,5» уже есть — пропуск', async () => {
    const w = await world();
    const file = xlsx(CATALOG, [
      ['Кола 0,5', null, null, null, null],
      ['Сок', 'Напитки', 'л', '4870001', '450,50'],
      ['Жвачка', null, null, null, null],
    ]);
    const items = count(w, 'SELECT COUNT(*) n FROM stock_items');
    const check = await upload(w, 'items', file, 'commit=0');
    expect(check.statusCode, check.body).toBe(200);
    expect(check.json()).toMatchObject({
      rows: 3,
      errors: [],
      errorsTotal: 0,
      create: { items: 2, groups: 1, suppliers: 0 },
      names: { items: ['Сок', 'Жвачка'], groups: ['Напитки'], suppliers: [] },
      skip: { items: 1 },
      committed: false,
    });
    expect(count(w, 'SELECT COUNT(*) n FROM stock_items')).toBe(items);

    const done = await upload(w, 'items', file, 'commit=1');
    expect(done.statusCode, done.body).toBe(201);
    expect(done.json()).toMatchObject({ committed: true, create: { items: 2, groups: 1 } });
    const catalog = (await w.h.req('GET', `${w.stock}/items`)).json().items as any[];
    const juice = catalog.find((i) => i.name === 'Сок');
    expect(juice).toMatchObject({ unit: 'l', barcode: '4870001', salePrice: 45_050, prices: [{ price: 45_050, validFrom: '2026-10-06' }] });
    expect(catalog.find((i) => i.name === 'Жвачка')).toMatchObject({ unit: 'pcs', salePrice: 0, groupId: null });
    expect(w.h.auditCount('stock_import', 'create')).toBe(1);
  });

  it('ошибки строк: нет названия, неизвестная единица, дубль в файле, отрицательная цена; запись при ошибках — 422', async () => {
    const w = await world();
    const file = xlsx(CATALOG, [
      [null, 'Напитки', null, null, null],
      ['Вода', null, 'ящ', null, null],
      ['Сок', null, null, null, null],
      ['сок', null, null, null, null],
      ['Чай', null, null, null, '-5'],
    ]);
    const check = await upload(w, 'items', file, 'commit=0');
    expect(check.json().errors).toEqual([
      { row: 2, field: 'Название', message: 'Укажите название' },
      { row: 3, field: 'Единица', message: 'Неизвестная единица «ящ»: шт, л, кг или уп' },
      { row: 5, field: 'Название', message: 'Товар «сок» уже есть в файле (строка 4)' },
      { row: 6, field: 'Цена продажи', message: 'Цена не меньше нуля' },
    ]);
    const before = count(w, 'SELECT COUNT(*) n FROM stock_items');
    const commit = await upload(w, 'items', file, 'commit=1');
    expect(commit.statusCode).toBe(422);
    expect(commit.json().error).toMatchObject({ code: 'IMPORT_INVALID', details: { errorsTotal: 4 } });
    expect(count(w, 'SELECT COUNT(*) n FROM stock_items')).toBe(before);
  });

  it('CSV через «,» и в cp1251 читается (R1); импорт журнала прежний', async () => {
    const w = await world();
    const comma = Buffer.from('Название,Единица,Цена продажи\nВода,шт,300\n', 'utf8');
    expect((await upload(w, 'items', comma, 'commit=0', 'каталог.csv')).json()).toMatchObject({ errors: [], create: { items: 1 } });
    const ansi = cp1251('Название;Группа\r\nСухарики;Снеки\r\n');
    expect((await upload(w, 'items', ansi, 'commit=0', 'каталог.csv')).json()).toMatchObject({ errors: [], names: { items: ['Сухарики'], groups: ['Снеки'] } });
    const noHeader = await upload(w, 'items', Buffer.from('a;b\n1;2\n', 'utf8'), 'commit=0', 'каталог.csv');
    expect([noHeader.statusCode, noHeader.json().error.code]).toEqual([422, 'IMPORT_HEADER']);
  });
});

describe('импорт поступлений (§9.1, Склад-2)', () => {
  it('строки с одним моментом и поставщиком — один документ; новый поставщик и товар создаются', async () => {
    const w = await world();
    const file = xlsx(RECEIPTS, [
      ['01.10.2026 09:00', 'Поставщик А', 'Кола 0,5', 10, '100000', null],
      ['01.10.2026 09:00', 'Поставщик А', 'Чипсы', 5, null, '700'],
      ['01.10.2026 09:00', 'Поставщик Б', 'Кола 0,5', 2, '20000', null],
      ['02.10.2026', null, 'Сухарики', 3, '1500', null],
    ]);
    const check = await upload(w, 'receipts', file, `warehouse=${w.wh}&commit=0`);
    expect(check.json()).toMatchObject({ errors: [], docs: 3, lines: 4, total: 100_000_00 + 3500_00 + 20_000_00 + 1500_00, create: { items: 1, suppliers: 1 }, names: { items: ['Сухарики'], suppliers: ['Поставщик Б'] } });
    const done = await upload(w, 'receipts', file, `warehouse=${w.wh}&commit=1`);
    expect(done.statusCode, done.body).toBe(201);
    const docs = (await w.h.req('GET', `${w.stock}/docs?type=receipt`)).json().docs as any[];
    // новые сверху; при одном моменте — больший номер выше
    expect(docs.map((d) => [d.number, d.source, d.linesCount, d.total])).toEqual([
      ['П-0003', 'import', 1, 1500_00],
      ['П-0002', 'import', 1, 20_000_00],
      ['П-0001', 'import', 2, 103_500_00],
    ]);
    // без времени — 12:00 по часам компании (Алматы, UTC+5)
    expect(docs[0].at).toBe('2026-10-02T07:00:00.000Z');
    const supplierB = w.h.t.sqlite.prepare("SELECT type FROM counterparties WHERE name = 'Поставщик Б'").get();
    expect(supplierB).toEqual({ type: 'supplier' });
    const balance = (await w.h.req('GET', `${w.stock}/balance?warehouse=${w.wh}`)).json().items as any[];
    expect(balance.find((i) => i.itemId === w.cola)).toMatchObject({ qty: 12_000, cost: 120_000_00 });
    expect(balance.find((i) => i.itemId === w.chips)).toMatchObject({ qty: 5000, cost: 3500_00 });
  });

  it('«грязный» файл (Review Focus 5): пустые строки, «1 234,50» и «1234.5», дробные штуки, будущее, комплект', async () => {
    const w = await world();
    await w.combo('Чипсы + кола', [[w.chips, 1000], [w.cola, 1000]]);
    const file = xlsx(RECEIPTS, [
      ['01.10.2026 09:00', 'Поставщик А', 'Кола 0,5', 1, '1 234,50', null],
      [null, null, null, null, null, null],
      ['01.10.2026 09:00', 'Поставщик А', 'Сироп', '0,25', '1234.5', null],
      ['01.10.2026 10:00', null, 'Кола 0,5', '1,5', '100', null],
      ['09.10.2026 10:00', null, 'Кола 0,5', 1, '100', null],
      ['01.10.2026 11:00', null, 'Чипсы + кола', 1, '100', null],
      ['01.10.2026 11:00', null, 'Кола 0,5', 1, null, null],
      ['31.02.2026', null, 'Кола 0,5', 1, '1', null],
      ['01.10.2026 11:00', null, 'Сироп', '0,0001', '1', null],
    ]);
    const check = (await upload(w, 'receipts', file, `warehouse=${w.wh}&commit=0`)).json();
    expect(check.rows).toBe(8);
    expect(check.errors).toEqual([
      { row: 5, field: 'Количество', message: 'Количество в штуках — целое' },
      { row: 6, field: 'Дата', message: 'Дата в будущем' },
      { row: 7, field: 'Товар', message: 'Комплект нельзя оприходовать — оприходуйте его составляющие' },
      { row: 8, field: 'Сумма', message: 'Укажите сумму или цену' },
      { row: 9, field: 'Дата', message: 'Неверная дата' },
      { row: 10, field: 'Количество', message: 'Не больше трёх знаков после запятой' },
    ]);
    // первые две строки — без ошибок: 1 234,50 ₸ и 1 234,50 ₸
    const ok = xlsx(RECEIPTS, [
      ['01.10.2026 09:00', 'Поставщик А', 'Кола 0,5', 1, '1 234,50', null],
      ['01.10.2026 09:00', 'Поставщик А', 'Сироп', '0,25', '1234.5', null],
    ]);
    expect((await upload(w, 'receipts', ok, `warehouse=${w.wh}&commit=0`)).json()).toMatchObject({ errors: [], docs: 1, total: 246_900 });
  });

  it('повторная загрузка того же файла — «Этот файл уже загружен»; после удаления документов принимается снова (R10)', async () => {
    const w = await world();
    const file = xlsx(RECEIPTS, [['01.10.2026 09:00', 'Поставщик А', 'Кола 0,5', 1, '100', null]]);
    expect((await upload(w, 'receipts', file, `warehouse=${w.wh}&commit=1`)).statusCode).toBe(201);
    const again = (await upload(w, 'receipts', file, `warehouse=${w.wh}&commit=0`)).json();
    expect(again.errors).toEqual([{ row: 0, field: 'Файл', message: 'Этот файл уже загружен' }]);
    const doc = (await w.h.req('GET', `${w.stock}/docs?type=receipt`)).json().docs[0];
    expect((await w.h.req('DELETE', `${w.stock}/docs/${doc.id}`)).statusCode).toBe(200);
    expect((await upload(w, 'receipts', file, `warehouse=${w.wh}&commit=1`)).statusCode).toBe(201);
    expect(count(w, "SELECT COUNT(*) n FROM stock_docs WHERE source = 'import' AND deleted_at IS NULL")).toBe(1);
  });

  it('склад: другой компании и архивный — 422; без склада — 400; поставщик только в архиве — ошибка строки', async () => {
    const w = await world();
    const file = xlsx(RECEIPTS, [['01.10.2026 09:00', 'Поставщик А', 'Кола 0,5', 1, '100', null]]);
    expect((await upload(w, 'receipts', file, 'commit=0')).statusCode).toBe(400);
    expect((await upload(w, 'receipts', file, 'warehouse=99999&commit=0')).json().error.code).toBe('INVARIANT_5');
    await w.h.req('POST', `${w.stock}/warehouses/${w.wh2}/archive`);
    expect((await upload(w, 'receipts', file, `warehouse=${w.wh2}&commit=0`)).json().error.code).toBe('ARCHIVED_REFERENCE');
    await w.h.req('POST', `/api/v1/companies/${w.cid}/counterparties/${w.supplier}/archive`);
    expect((await upload(w, 'receipts', file, `warehouse=${w.wh}&commit=0`)).json().errors).toEqual([{ row: 2, field: 'Поставщик', message: 'Поставщик «Поставщик А» в архиве' }]);
  });

  it('книга с датами 1904 (Mac Excel): число даты читается без сдвига на 4 года', async () => {
    const w = await world();
    // 01.10.2026 09:00 числом Excel системы 1900, минус 1 462 дня — та же дата в системе 1904
    const serial1900 = (Date.UTC(2026, 9, 1) - Date.UTC(1899, 11, 30)) / 86_400_000 + 9 / 24;
    const file = finmapLikeXlsx([[serial1900 - 1462, 'Поставщик А', 'Кола 0,5', 1, 100, null]], { headers: RECEIPTS, date1904: true });
    const res = await upload(w, 'receipts', file, `warehouse=${w.wh}&commit=1`);
    expect(res.statusCode, res.body).toBe(201);
    const doc = (await w.h.req('GET', `${w.stock}/docs?type=receipt`)).json().docs[0];
    expect(doc.at).toBe('2026-10-01T04:00:00.000Z');
  });

  it('поставщик длиннее 200 символов — ошибка строки; сумма по цене — без двойного округления', async () => {
    const w = await world();
    const file = xlsx(RECEIPTS, [
      ['01.10.2026 09:00', 'П'.repeat(201), 'Кола 0,5', 1, '100', null],
      ['01.10.2026 09:00', null, 'Сироп', '3', null, '0,333'],
    ]);
    const check = (await upload(w, 'receipts', file, `warehouse=${w.wh}&commit=0`)).json();
    expect(check.errors).toEqual([{ row: 2, field: 'Поставщик', message: 'Не длиннее 200 символов' }]);
    // 0,333 ₸ × 3 л = 0,999 ₸ → 1,00 ₸ (а не 0,33 × 3 = 0,99)
    expect(check.total).toBe(100);
  });

  it('пределы: больше 5 000 строк — 422, файл больше 5 МБ — 413', async () => {
    const w = await world();
    const rows = Array.from({ length: 5001 }, (_, i): Value[] => ['01.10.2026 09:00', null, `Товар ${i}`, 1, '1', null]);
    const many = await upload(w, 'receipts', xlsx(RECEIPTS, rows), `warehouse=${w.wh}&commit=0`);
    expect([many.statusCode, many.json().error.message]).toEqual([422, 'В файле больше 5 000 строк']);
    const big = await upload(w, 'items', Buffer.alloc(5 * 1024 * 1024 + 1, 0x41), 'commit=0', 'каталог.csv');
    expect(big.statusCode).toBe(413);
  });

  it('5 000 строк поступлений записываются меньше чем за 10 с (решение 12)', async () => {
    const w = await world();
    const rows = Array.from({ length: 5000 }, (_, i): Value[] => [`${String(1 + (i % 28)).padStart(2, '0')}.09.2026 09:00`, `Поставщик ${i % 3}`, `Товар ${i % 50}`, 1 + (i % 4), String(100 + i), null]);
    const started = performance.now();
    const res = await upload(w, 'receipts', xlsx(RECEIPTS, rows), `warehouse=${w.wh}&commit=1`);
    const ms = performance.now() - started;
    expect(res.statusCode, res.body.slice(0, 300)).toBe(201);
    expect(res.json()).toMatchObject({ lines: 5000, create: { items: 50, suppliers: 3 } });
    expect(ms).toBeLessThan(10_000);
  }, 30_000);
});
