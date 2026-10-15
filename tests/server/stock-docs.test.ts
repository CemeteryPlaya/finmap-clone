import { afterEach, describe, expect, it } from 'vitest';
import type { AccountMapping, ImportUndoResponse } from '../../src/shared/schemas/imports';
import { excelSerial as xl, finmapLikeRow as fr } from '../helpers/finmap-like';
import { importRows } from '../helpers/imports';
import { stockWorld, type StockWorld } from '../helpers/stock';

let w: StockWorld | null = null;
afterEach(async () => {
  await w?.h.t.cleanup();
  w = null;
});

const D1 = '2026-10-01T10:00:00.000Z';
const D2 = '2026-10-02T10:00:00.000Z';
const D3 = '2026-10-03T10:00:00.000Z';
const D4 = '2026-10-04T10:00:00.000Z';
const D5 = '2026-10-05T10:00:00.000Z';
const P = 'П'; // «П» — поступление
const R = 'Р'; // «Р» — продажа
const S = 'С'; // «С» — списание

async function world(): Promise<StockWorld> {
  w = await stockWorld('2026-10-06T12:00:00.000Z');
  return w;
}

const rows = <T>(world: StockWorld, sql: string, ...args: unknown[]) => world.h.t.sqlite.prepare(sql).all(...args) as T[];
const state = (world: StockWorld, item: number) =>
  rows<{ qty_left: number; cost_left: number }>(world, 'SELECT qty_left, cost_left FROM stock_batches WHERE item_id = ? ORDER BY at, id', item).map((b) => [b.qty_left, b.cost_left]);

describe('документы: номера, создание, чтение', () => {
  it('номера по типу в компании: П-0001, Р-0001, С-0001; удалённый документ номер не освобождает', async () => {
    const w = await world();
    const r1 = await w.receipt(D1, [[w.cola, 10_000, 100_000]]);
    const r2 = await w.receipt(D2, [[w.cola, 10_000, 120_000]]);
    const s1 = await w.sale(D3, [[w.cola, 1000, 50_000]]);
    const o1 = await w.writeoff(D3, [[w.cola, 1000]]);
    expect([r1.number, r2.number, s1.number, o1.number]).toEqual([`${P}-0001`, `${P}-0002`, `${R}-0001`, `${S}-0001`]);
    expect(await w.h.req('DELETE', `${w.stock}/docs/${r2.id}`)).toMatchObject({ statusCode: 200 });
    expect((await w.receipt(D3, [[w.cola, 1000, 1]])).number).toBe(`${P}-0003`);
    expect(r1).toMatchObject({ type: 'receipt', status: 'posted', source: 'manual', version: 1, warehouseId: w.wh, counterpartyId: w.supplier, total: 100_000 });
  });

  it('GET документ: строки с суммой, себестоимостью и «нет партии»', async () => {
    const w = await world();
    await w.receipt(D1, [[w.cola, 2000, 1000]]);
    const sale = await w.sale(D2, [[w.cola, 3000, 150_000]]);
    const got = (await w.h.req('GET', `${w.stock}/docs/${sale.id}`)).json().doc;
    expect(got.total).toBe(150_000);
    expect(got.lines).toEqual([{ id: expect.any(Number), position: 0, itemId: w.cola, qty: 3000, amount: 150_000, cost: 1000, uncovered: 1000 }]);
    expect((await w.h.req('GET', `/api/v1/companies/${w.cid}/stock/docs/9999`)).statusCode).toBe(404);
  });

  it('список: фильтры по типу, складу и датам; новые сверху; итог и число строк', async () => {
    const w = await world();
    await w.receipt(D1, [[w.cola, 10_000, 100_000], [w.chips, 5000, 50_000]]);
    await w.sale(D3, [[w.cola, 1000, 50_000]]);
    await w.doc({ type: 'receipt', at: D2, warehouseId: w.wh2, lines: [{ itemId: w.cola, qty: 1000, amount: 9000 }] });
    const all = (await w.h.req('GET', `${w.stock}/docs`)).json();
    expect(all.docs.map((d: any) => d.number)).toEqual([`${R}-0001`, `${P}-0002`, `${P}-0001`]);
    expect(all.docs[2]).toMatchObject({ total: 150_000, linesCount: 2 });
    expect(all.hasMore).toBe(false);
    const q = async (query: string) => (await w!.h.req('GET', `${w!.stock}/docs?${query}`)).json().docs.map((d: any) => d.number);
    expect(await q('type=receipt')).toEqual([`${P}-0002`, `${P}-0001`]);
    expect(await q(`warehouse=${w.wh2}`)).toEqual([`${P}-0002`]);
    expect(await q('from=2026-10-02&to=2026-10-02')).toEqual([`${P}-0002`]);
    expect(await q('from=2026-10-02')).toEqual([`${R}-0001`, `${P}-0002`]);
    expect((await w.h.req('GET', `${w.stock}/docs?limit=2`)).json()).toMatchObject({ hasMore: true });
    expect((await w.h.req('GET', `${w.stock}/docs?limit=2&offset=2`)).json().docs).toHaveLength(1);
    expect((await w.h.req('GET', `${w.stock}/docs?type=transfer`)).statusCode).toBe(400);
  });

  it('история: создание документа пишется один раз', async () => {
    const w = await world();
    await w.receipt(D1, [[w.cola, 1000, 100]]);
    expect(w.h.auditCount('stock_doc', 'create')).toBe(1);
  });
});

describe('FIFO по документам (§5.2)', () => {
  it('продажа берёт из самых ранних партий; остаток партии и стоимость сходятся', async () => {
    const w = await world();
    await w.receipt(D1, [[w.cola, 10_000, 100_000]]);
    await w.receipt(D2, [[w.cola, 10_000, 150_000]]);
    const sale = await w.sale(D3, [[w.cola, 12_000, 600_000]]);
    expect((await w.h.req('GET', `${w.stock}/docs/${sale.id}`)).json().doc.lines[0]).toMatchObject({ cost: 100_000 + 30_000, uncovered: 0 });
    expect(state(w, w.cola)).toEqual([[0, 0], [8000, 120_000]]);
    const allocs = rows<{ qty: number; cost: number }>(w, 'SELECT qty, cost FROM stock_allocations ORDER BY id');
    expect(allocs).toEqual([{ qty: 10_000, cost: 100_000 }, { qty: 2000, cost: 30_000 }]);
  });

  it('тиыны: три продажи по штуке из партии в 3 штуки за 1,00 — 0,33 + 0,33 + 0,34', async () => {
    const w = await world();
    await w.receipt(D1, [[w.cola, 3000, 100]]);
    const costs: number[] = [];
    for (const at of [D2, D3, D4]) {
      const s = await w.sale(at, [[w.cola, 1000, 50_000]]);
      costs.push((await w.h.req('GET', `${w.stock}/docs/${s.id}`)).json().doc.lines[0].cost);
    }
    expect(costs).toEqual([33, 33, 34]);
    expect(state(w, w.cola)).toEqual([[0, 0]]);
  });

  it('пары независимы: другой товар и другой склад не влияют друг на друга', async () => {
    const w = await world();
    await w.receipt(D1, [[w.cola, 5000, 50_000], [w.chips, 5000, 90_000]]);
    await w.doc({ type: 'receipt', at: D1, warehouseId: w.wh2, lines: [{ itemId: w.cola, qty: 5000, amount: 70_000 }] });
    const s = await w.sale(D2, [[w.cola, 2000, 100_000], [w.chips, 1000, 70_000]]);
    expect((await w.h.req('GET', `${w.stock}/docs/${s.id}`)).json().doc.lines.map((l: any) => l.cost)).toEqual([20_000, 18_000]);
    expect(rows(w, 'SELECT warehouse_id w, item_id i, qty_left q FROM stock_batches ORDER BY warehouse_id, item_id')).toEqual([
      { w: w.wh, i: w.cola, q: 3000 },
      { w: w.wh, i: w.chips, q: 4000 },
      { w: w.wh2, i: w.cola, q: 5000 },
    ]);
  });

  it('ручное списание берёт по FIFO так же, как продажа, и не имеет суммы', async () => {
    const w = await world();
    await w.receipt(D1, [[w.cola, 4000, 40_000]]);
    const o = await w.writeoff(D2, [[w.cola, 1000]], { reason: 'spoiled' });
    expect(o).toMatchObject({ reason: 'spoiled', counterpartyId: null, total: 0 });
    expect((await w.h.req('GET', `${w.stock}/docs/${o.id}`)).json().doc.lines[0]).toMatchObject({ amount: null, cost: 10_000, uncovered: 0 });
  });
});

describe('нехватка остатка (§5.3)', () => {
  it('продажа без остатка проводится: строка «Нет партии», себестоимости нет', async () => {
    const w = await world();
    const s = await w.sale(D2, [[w.cola, 2000, 100_000]]);
    expect((await w.h.req('GET', `${w.stock}/docs/${s.id}`)).json().doc.lines[0]).toMatchObject({ cost: null, uncovered: 2000 });
    expect(rows(w, 'SELECT batch_id, qty, cost FROM stock_allocations')).toEqual([{ batch_id: null, qty: 2000, cost: null }]);
  });

  it('поступление с более ранней датой, введённое позже, закрывает долг продажи', async () => {
    const w = await world();
    const s = await w.sale(D3, [[w.cola, 2000, 100_000]]);
    const res = await w.post(`${w.stock}/docs`, { type: 'receipt', at: D1, warehouseId: w.wh, lines: [{ itemId: w.cola, qty: 5000, amount: 50_000 }] });
    expect(res.impact).toEqual({ sales: 1, writeoffs: 0, since: D1 });
    expect((await w.h.req('GET', `${w.stock}/docs/${s.id}`)).json().doc.lines[0]).toMatchObject({ cost: 20_000, uncovered: 0 });
    expect(state(w, w.cola)).toEqual([[3000, 30_000]]);
  });

  it('поступление позже продажи долг не закрывает', async () => {
    const w = await world();
    const s = await w.sale(D2, [[w.cola, 2000, 100_000]]);
    const res = await w.post(`${w.stock}/docs`, { type: 'receipt', at: D3, warehouseId: w.wh, lines: [{ itemId: w.cola, qty: 5000, amount: 50_000 }] });
    expect(res.impact).toEqual({ sales: 0, writeoffs: 0, since: null });
    expect((await w.h.req('GET', `${w.stock}/docs/${s.id}`)).json().doc.lines[0]).toMatchObject({ cost: null, uncovered: 2000 });
  });

  it('ручное списание без остатка — 422 с названием, остатком и датой; ничего не записано', async () => {
    const w = await world();
    await w.receipt(D1, [[w.cola, 2000, 20_000]]);
    const res = await w.h.req('POST', `${w.stock}/docs`, { type: 'writeoff', at: D2, warehouseId: w.wh, reason: 'defect', lines: [{ itemId: w.cola, qty: 5000 }] });
    expect(res.statusCode).toBe(422);
    expect(res.json().error).toMatchObject({ code: 'INSUFFICIENT_STOCK', message: 'Не хватает «Кола 0,5»: на складе 2 шт на 02.10.2026', details: { itemId: w.cola, available: 2000 } });
    expect(rows(w, 'SELECT COUNT(*) n FROM stock_docs')).toEqual([{ n: 1 }]);
    expect(state(w, w.cola)).toEqual([[2000, 20_000]]);
    // следующий номер не потерян откатом
    expect((await w.writeoff(D2, [[w.cola, 1000]])).number).toBe(`${S}-0001`);
  });

  it('списание литров показывает остаток с дробью', async () => {
    const w = await world();
    await w.receipt(D1, [[w.syrup, 1500, 3000]]);
    const res = await w.h.req('POST', `${w.stock}/docs`, { type: 'writeoff', at: D2, warehouseId: w.wh, reason: 'spoiled', lines: [{ itemId: w.syrup, qty: 2000 }] });
    expect(res.json().error.message).toBe('Не хватает «Сироп»: на складе 1,5 л на 02.10.2026');
  });
});

describe('изменение прошлого (§5.4)', () => {
  it('поступление задним числом встаёт в начало и меняет себестоимость уже проданного; предупреждение со счётом продаж', async () => {
    const w = await world();
    await w.receipt(D2, [[w.cola, 10_000, 100_000]]);
    await w.receipt(D3, [[w.cola, 10_000, 300_000]]);
    const s = await w.sale(D4, [[w.cola, 12_000, 600_000]]);
    expect((await w.h.req('GET', `${w.stock}/docs/${s.id}`)).json().doc.lines[0].cost).toBe(100_000 + 60_000);
    const res = await w.post(`${w.stock}/docs`, { type: 'receipt', at: D1, warehouseId: w.wh, lines: [{ itemId: w.cola, qty: 4000, amount: 400_000 }] });
    expect(res.impact).toEqual({ sales: 1, writeoffs: 0, since: D1 });
    // теперь сначала 4 по 100,00, затем 8 по 10,00 (партия D2)
    expect((await w.h.req('GET', `${w.stock}/docs/${s.id}`)).json().doc.lines[0].cost).toBe(400_000 + 80_000);
    expect(state(w, w.cola)).toEqual([[0, 0], [2000, 20_000], [10_000, 300_000]]);
  });

  it('dryRun считает последствия и не пишет: ни документа, ни номера, ни истории', async () => {
    const w = await world();
    await w.receipt(D2, [[w.cola, 10_000, 100_000]]);
    const s = await w.sale(D3, [[w.cola, 2000, 100_000]]);
    const before = w.h.auditCount('stock_doc');
    const res = await w.h.req('POST', `${w.stock}/docs`, { type: 'receipt', at: D1, warehouseId: w.wh, lines: [{ itemId: w.cola, qty: 1000, amount: 999_000 }], dryRun: true });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ doc: null, impact: { sales: 1, writeoffs: 0, since: D1 } });
    expect(rows(w, 'SELECT COUNT(*) n FROM stock_docs')).toEqual([{ n: 2 }]);
    expect(w.h.auditCount('stock_doc')).toBe(before);
    expect((await w.h.req('GET', `${w.stock}/docs/${s.id}`)).json().doc.lines[0].cost).toBe(20_000);
    expect((await w.receipt(D4, [[w.cola, 1000, 1]])).number).toBe(`${P}-0002`);
  });

  it('удаление поступления, из которого уже продавали: продажа остаётся без партии, документ пропадает из списка', async () => {
    const w = await world();
    const r = await w.receipt(D1, [[w.cola, 10_000, 100_000]]);
    const s = await w.sale(D2, [[w.cola, 4000, 200_000]]);
    const probe = await w.h.req('DELETE', `${w.stock}/docs/${r.id}?dryRun=1`);
    expect(probe.json()).toEqual({ doc: null, impact: { sales: 1, writeoffs: 0, since: D1 } });
    expect((await w.h.req('GET', `${w.stock}/docs/${r.id}`)).json().doc.deletedAt).toBeNull();
    const del = await w.h.req('DELETE', `${w.stock}/docs/${r.id}`);
    expect(del.statusCode).toBe(200);
    expect(del.json().impact).toEqual({ sales: 1, writeoffs: 0, since: D1 });
    expect(del.json().doc).toMatchObject({ version: 2 });
    expect((await w.h.req('GET', `${w.stock}/docs/${s.id}`)).json().doc.lines[0]).toMatchObject({ cost: null, uncovered: 4000 });
    expect(rows(w, 'SELECT COUNT(*) n FROM stock_batches')).toEqual([{ n: 0 }]);
    expect((await w.h.req('GET', `${w.stock}/docs`)).json().docs.map((d: any) => d.id)).toEqual([s.id]);
    // повторное удаление — без последствий и без второй записи в истории
    const again = await w.h.req('DELETE', `${w.stock}/docs/${r.id}`);
    expect(again.json().impact).toEqual({ sales: 0, writeoffs: 0, since: null });
    expect(w.h.auditCount('stock_doc', 'delete')).toBe(1);
  });

  it('удаление поступления, из которого уже списали вручную, — 422, всё остаётся как было', async () => {
    const w = await world();
    const r = await w.receipt(D1, [[w.cola, 10_000, 100_000]]);
    await w.writeoff(D2, [[w.cola, 4000]]);
    const res = await w.h.req('DELETE', `${w.stock}/docs/${r.id}`);
    expect(res.statusCode).toBe(422);
    expect(res.json().error).toMatchObject({ code: 'INSUFFICIENT_STOCK', message: 'Не хватает «Кола 0,5»: на складе 0 шт на 02.10.2026' });
    expect((await w.h.req('GET', `${w.stock}/docs/${r.id}`)).json().doc).toMatchObject({ deletedAt: null, version: 1 });
    expect(state(w, w.cola)).toEqual([[6000, 60_000]]);
  });

  it('удаление продажи возвращает партии на склад', async () => {
    const w = await world();
    await w.receipt(D1, [[w.cola, 10_000, 100_000]]);
    const s = await w.sale(D2, [[w.cola, 4000, 200_000]]);
    expect(state(w, w.cola)).toEqual([[6000, 60_000]]);
    await w.h.req('DELETE', `${w.stock}/docs/${s.id}`);
    expect(state(w, w.cola)).toEqual([[10_000, 100_000]]);
    expect(rows(w, 'SELECT COUNT(*) n FROM stock_allocations')).toEqual([{ n: 0 }]);
  });
});

describe('проверки документа (§10)', () => {
  const body = (w: StockWorld, over: Record<string, unknown>) => ({
    type: 'receipt',
    at: D1,
    warehouseId: w.wh,
    counterpartyId: w.supplier,
    lines: [{ itemId: w.cola, qty: 1000, amount: 100 }],
    ...over,
  });
  const post = (w: StockWorld, over: Record<string, unknown>) => w.h.req('POST', `${w.stock}/docs`, body(w, over));

  it('штуки — только целые; литры — до трёх знаков', async () => {
    const w = await world();
    const res = await post(w, { lines: [{ itemId: w.cola, qty: 1500, amount: 100 }] });
    expect([res.statusCode, res.json().error.fields]).toEqual([400, { 'lines.0.qty': 'Количество в штуках — целое' }]);
    expect((await post(w, { lines: [{ itemId: w.syrup, qty: 1500, amount: 100 }] })).statusCode).toBe(201);
    expect((await post(w, { lines: [{ itemId: w.syrup, qty: 0, amount: 100 }] })).statusCode).toBe(400);
  });

  it('суммы: у поступления и продажи обязательны, у списания их нет; причина — только у списания', async () => {
    const w = await world();
    expect((await post(w, { lines: [{ itemId: w.cola, qty: 1000 }] })).json().error.fields).toEqual({ 'lines.0.amount': 'Укажите сумму строки' });
    expect((await post(w, { type: 'sale', counterpartyId: null, lines: [{ itemId: w.cola, qty: 1000 }] })).statusCode).toBe(400);
    expect((await post(w, { type: 'writeoff', counterpartyId: null, reason: 'defect' })).json().error.fields).toEqual({ 'lines.0.amount': 'У списания нет суммы' });
    expect((await post(w, { type: 'writeoff', counterpartyId: null, lines: [{ itemId: w.cola, qty: 1000 }] })).json().error.fields).toEqual({ reason: 'Укажите причину списания' });
    expect((await post(w, { reason: 'defect' })).json().error.fields).toEqual({ reason: 'Причина — только у списания' });
    expect((await post(w, { type: 'writeoff', reason: 'defect', lines: [{ itemId: w.cola, qty: 1000 }] })).json().error.fields).toEqual({ counterpartyId: 'У списания нет контрагента' });
  });

  it('склад, товар и контрагент другой компании отклоняются; неизвестные поля и пустые строки — 400', async () => {
    const w = await world();
    const other = (await w.h.req('POST', '/api/v1/companies', { name: 'ТОО Другое' })).json().company.id as number;
    const proj = (await w.post(`/api/v1/companies/${other}/projects`, { name: 'Чужой', templateKey: 'general' })).project.id as number;
    const foreignWh = (await w.post(`/api/v1/companies/${other}/stock/warehouses`, { projectId: proj, name: 'Чужой' })).warehouse.id as number;
    expect((await post(w, { warehouseId: foreignWh })).json().error.code).toBe('INVARIANT_5');
    expect((await post(w, { lines: [{ itemId: 99_999, qty: 1000, amount: 1 }] })).json().error.code).toBe('INVARIANT_5');
    expect((await post(w, { counterpartyId: 99_999 })).json().error.code).toBe('INVARIANT_5');
    expect((await post(w, { lines: [] })).statusCode).toBe(400);
    expect((await post(w, { type: 'transfer' })).statusCode).toBe(400);
    expect((await post(w, { at: '2026-10-01' })).statusCode).toBe(400);
  });

  it('дата в будущем по APP_TIMEZONE — 422; сегодняшняя можно', async () => {
    const w = await world();
    const future = await post(w, { at: '2026-10-07T00:00:00.000Z' });
    expect([future.statusCode, future.json().error.code]).toEqual([422, 'INVARIANT_6']);
    expect((await post(w, { at: '2026-10-06T11:59:00.000Z' })).statusCode).toBe(201);
  });

  it('архивный товар, склад и контрагент — только уже выбранные; новый выбор — 422', async () => {
    const w = await world();
    await w.h.req('POST', `${w.stock}/items/${w.chips}/archive`);
    const item = await post(w, { lines: [{ itemId: w.chips, qty: 1000, amount: 1 }] });
    expect([item.statusCode, item.json().error.code]).toEqual([422, 'ARCHIVED_REFERENCE']);
    await w.h.req('POST', `${w.stock}/warehouses/${w.wh2}/archive`);
    expect((await post(w, { warehouseId: w.wh2 })).json().error.code).toBe('ARCHIVED_REFERENCE');
    await w.h.req('POST', `/api/v1/companies/${w.cid}/counterparties/${w.supplier}/archive`);
    expect((await post(w, {})).json().error.code).toBe('ARCHIVED_REFERENCE');
  });

  it('единицу товара с документами менять и сам товар удалять нельзя; контрагента и проект со складом — тоже', async () => {
    const w = await world();
    await w.receipt(D1, [[w.cola, 1000, 100]]);
    const unit = await w.h.req('PATCH', `${w.stock}/items/${w.cola}`, { unit: 'l' });
    expect([unit.statusCode, unit.json().error.fields]).toEqual([422, { unit: 'По товару есть документы' }]);
    expect((await w.h.req('PATCH', `${w.stock}/items/${w.chips}`, { unit: 'l' })).statusCode).toBe(200);
    expect((await w.h.req('DELETE', `${w.stock}/items/${w.cola}`)).json().error.code).toBe('INVARIANT_9');
    expect((await w.h.req('DELETE', `/api/v1/companies/${w.cid}/counterparties/${w.supplier}`)).json().error.code).toBe('INVARIANT_9');
  });
});

describe('архивная компания', () => {
  it('документы читаются, любая запись — 422 ARCHIVED_REFERENCE', async () => {
    const w = await world();
    const r = await w.receipt(D1, [[w.cola, 1000, 100]]);
    w.h.t.sqlite.prepare("UPDATE companies SET archived_at = '2026-10-06T00:00:00.000Z' WHERE id = ?").run(w.cid);
    expect((await w.h.req('GET', `${w.stock}/docs`)).statusCode).toBe(200);
    expect((await w.h.req('GET', `${w.stock}/docs/${r.id}`)).statusCode).toBe(200);
    const writes: [string, string, unknown][] = [
      ['POST', `${w.stock}/docs`, { type: 'receipt', at: D1, warehouseId: w.wh, lines: [{ itemId: w.cola, qty: 1000, amount: 1 }] }],
      ['POST', `${w.stock}/docs`, { type: 'receipt', at: D1, warehouseId: w.wh, lines: [{ itemId: w.cola, qty: 1000, amount: 1 }], dryRun: true }],
      ['PATCH', `${w.stock}/docs/${r.id}`, { version: 1, comment: 'x' }],
      ['DELETE', `${w.stock}/docs/${r.id}`, undefined],
    ];
    for (const [method, url, payload] of writes) {
      const res = await w.h.req(method as 'POST', url, payload);
      expect([res.statusCode, res.json().error.code], `${method} ${url}`).toEqual([422, 'ARCHIVED_REFERENCE']);
    }
    expect(rows(w, 'SELECT COUNT(*) n FROM stock_docs')).toEqual([{ n: 1 }]);
  });
});

describe('оплаты поступления и отмена импорта', () => {
  it('поставщика поступления с оплатами менять нельзя — 422 STOCK_DOC_HAS_PAYMENTS; остальное можно', async () => {
    const w = await world();
    const other = (await w.post(`/api/v1/companies/${w.cid}/counterparties`, { type: 'supplier', name: 'Поставщик Б' })).counterparty.id as number;
    const r = await w.receipt(D1, [[w.cola, 1000, 100]]);
    const op = (
      await w.post(w.ops, {
        type: 'expense',
        paidAt: D2,
        accrualDate: null,
        accountId: w.kzt,
        amount: 100,
        toAccountId: null,
        toAmount: null,
        counterpartyId: w.supplier,
        comment: null,
        lines: [{ categoryId: w.expense, projectId: null, amount: 100 }],
        tagIds: [],
      })
    ).operation.id as number;
    // оплаты появятся в задаче 5 (API); здесь строка вставлена напрямую
    w.h.t.sqlite.prepare('INSERT INTO stock_doc_payments (doc_id, operation_id, amount) VALUES (?, ?, 100)').run(r.id, op);
    const res = await w.h.req('PATCH', `${w.stock}/docs/${r.id}`, { version: 1, counterpartyId: other });
    expect([res.statusCode, res.json().error.code, res.json().error.message]).toEqual([422, 'STOCK_DOC_HAS_PAYMENTS', 'У поступления есть оплаты — сначала снимите их в расходах']);
    expect((await w.h.req('PATCH', `${w.stock}/docs/${r.id}`, { version: 1, counterpartyId: w.supplier, comment: 'x' })).statusCode).toBe(200);
  });

  it('контрагент и проект, созданные импортом и занятые складом, при отмене остаются', async () => {
    const w = await world();
    const mappings: AccountMapping[] = [{ key: 'касса', kind: 'existing', accountId: w.kzt, targetBalance: 2_000_000 }];
    const r = await importRows(
      w,
      [fr({ paidAt: xl('2026-10-03', '22:07:30'), amount: 8500, from: 'Касса', category: 'Зарплата', counterparty: 'Поставщик Б', project: 'Клуб 9' })],
      { accounts: mappings },
    );
    const sql = (q: string) => w.h.t.sqlite.prepare(q).get() as { id: number };
    const cp = sql("SELECT id FROM counterparties WHERE name = 'Поставщик Б'").id;
    const project = sql("SELECT id FROM projects WHERE name = 'Клуб 9'").id;
    const wh = (await w.post(`${w.stock}/warehouses`, { projectId: project, name: 'Бар Клуб 9' })).warehouse.id as number;
    await w.doc({ type: 'receipt', at: D1, warehouseId: wh, counterpartyId: cp, lines: [{ itemId: w.cola, qty: 1000, amount: 100 }] });
    const res = await w.h.req('POST', `/api/v1/companies/${w.cid}/imports/${r.import.id}/undo`, { includeEdited: false, edited: 0 });
    expect(res.statusCode, res.body).toBe(200);
    const { result } = res.json() as ImportUndoResponse;
    expect(result.kept.names).toEqual(expect.arrayContaining([{ entity: 'counterparty', name: 'Поставщик Б' }, { entity: 'project', name: 'Клуб 9' }]));
    expect(result.deleted.counterparties).toBe(0);
    expect(result.deleted.projects).toBe(0);
    expect(sql("SELECT id FROM counterparties WHERE name = 'Поставщик Б'").id).toBe(cp);
    expect(sql("SELECT id FROM projects WHERE name = 'Клуб 9'").id).toBe(project);
  });
});
