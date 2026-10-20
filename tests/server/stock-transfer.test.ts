import { afterEach, describe, expect, it } from 'vitest';
import { groupsOf } from '../../src/server/modules/stock/recalc';
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
const M = 'М'; // «М» — перемещение

async function world(): Promise<StockWorld> {
  w = await stockWorld('2026-10-06T12:00:00.000Z');
  return w;
}

const balanceOf = async (world: StockWorld, wh: number, item: number) =>
  ((await world.h.req('GET', `${world.stock}/balance?warehouse=${wh}`)).json().items as any[]).find((i) => i.itemId === item);
const count = async (world: StockWorld, table: string) => ((await world.h.t.q(`SELECT COUNT(*) n FROM ${table}`))[0] as { n: number }).n;

describe('перемещение (§5.2, Склад-2)', () => {
  it('номер М-0001; остатки и себестоимость на обоих складах; стоимость складов не меняется', async () => {
    const w = await world();
    await w.receipt(D1, [[w.cola, 10_000, 100_000]]);
    const t = await w.transfer(D2, w.wh, w.wh2, [[w.cola, 4000]]);
    expect(t).toMatchObject({ number: `${M}-0001`, type: 'transfer', status: 'posted', warehouseId: w.wh, toWarehouseId: w.wh2, counterpartyId: null, reason: null, total: 0 });
    expect(t.lines).toEqual([{ id: expect.any(Number), position: 0, itemId: w.cola, qty: 4000, amount: null, cost: 40_000, uncovered: 0 }]);

    const there = await balanceOf(w, w.wh2, w.cola);
    expect(there).toMatchObject({ qty: 4000, cost: 40_000 });
    expect(there.batches).toEqual([expect.objectContaining({ docNumber: `${M}-0001`, warehouseId: w.wh2, counterpartyId: null, qtyLeft: 4000, costLeft: 40_000 })]);
    expect(await balanceOf(w, w.wh, w.cola)).toMatchObject({ qty: 6000, cost: 60_000 });

    const value = (await w.h.req('GET', `${w.stock}/value`)).json();
    expect(value.warehouses.map((x: any) => [x.warehouseId, x.value])).toEqual([
      [w.wh, 60_000],
      [w.wh2, 40_000],
    ]);
    expect(value.total).toBe(100_000);
  });

  it('продажа на складе-получателе берёт партии перемещения; нехватка — без партии', async () => {
    const w = await world();
    await w.receipt(D1, [[w.cola, 10_000, 100_000]]);
    await w.transfer(D2, w.wh, w.wh2, [[w.cola, 4000]]);
    const sale = await w.doc({ type: 'sale', at: D3, warehouseId: w.wh2, lines: [{ itemId: w.cola, qty: 5000, amount: 250_000 }] });
    expect(sale.lines[0]).toMatchObject({ cost: 40_000, uncovered: 1000 });
  });

  it('туда и обратно, затем правка первого перемещения задним числом (Review Focus 1)', async () => {
    const w = await world();
    await w.receipt(D1, [[w.cola, 10_000, 100_000]]);
    const first = await w.transfer(D2, w.wh, w.wh2, [[w.cola, 4000]]);
    await w.transfer(D3, w.wh2, w.wh, [[w.cola, 1000]]);
    const sale = await w.doc({ type: 'sale', at: D4, warehouseId: w.wh2, lines: [{ itemId: w.cola, qty: 3000, amount: 150_000 }] });
    expect(sale.lines[0]).toMatchObject({ cost: 30_000, uncovered: 0 });

    const res = await w.h.req('PATCH', `${w.stock}/docs/${first.id}`, { version: first.version, lines: [{ itemId: w.cola, qty: 2000 }] });
    expect(res.statusCode, res.body).toBe(200);
    expect(res.json().impact).toEqual({ sales: 1, writeoffs: 0, since: D2 });
    const after = (await w.h.req('GET', `${w.stock}/docs/${sale.id}`)).json().doc;
    expect(after.lines[0]).toMatchObject({ cost: 10_000, uncovered: 2000 });
    expect(await balanceOf(w, w.wh, w.cola)).toMatchObject({ qty: 9000, cost: 90_000 });
  });

  it('ошибки §10: тот же склад, нехватка, получатель у другого типа, чужой и архивный получатель', async () => {
    const w = await world();
    await w.receipt(D1, [[w.cola, 2000, 20_000]]);
    const same = await w.h.req('POST', `${w.stock}/docs`, { type: 'transfer', at: D2, warehouseId: w.wh, toWarehouseId: w.wh, lines: [{ itemId: w.cola, qty: 1000 }] });
    expect(same.statusCode).toBe(422);
    expect(same.json().error.fields).toEqual({ toWarehouseId: 'Склад-получатель совпадает с отправителем' });

    const short = await w.h.req('POST', `${w.stock}/docs`, { type: 'transfer', at: D2, warehouseId: w.wh, toWarehouseId: w.wh2, lines: [{ itemId: w.cola, qty: 3000 }] });
    expect(short.statusCode).toBe(422);
    expect(short.json().error).toMatchObject({ code: 'INSUFFICIENT_STOCK', message: 'Не хватает «Кола 0,5»: на складе 2 шт на 02.10.2026' });

    const missing = await w.h.req('POST', `${w.stock}/docs`, { type: 'transfer', at: D2, warehouseId: w.wh, lines: [{ itemId: w.cola, qty: 1000 }] });
    expect(missing.statusCode).toBe(400);
    expect(missing.json().error.fields).toEqual({ toWarehouseId: 'Выберите склад-получатель' });

    const onReceipt = await w.h.req('POST', `${w.stock}/docs`, { type: 'receipt', at: D2, warehouseId: w.wh, toWarehouseId: w.wh2, lines: [{ itemId: w.cola, qty: 1000, amount: 1 }] });
    expect(onReceipt.statusCode).toBe(400);
    expect(onReceipt.json().error.fields).toEqual({ toWarehouseId: 'Склад-получатель — только у перемещения' });

    const withAmount = await w.h.req('POST', `${w.stock}/docs`, { type: 'transfer', at: D2, warehouseId: w.wh, toWarehouseId: w.wh2, lines: [{ itemId: w.cola, qty: 1000, amount: 5 }] });
    expect(withAmount.statusCode).toBe(400);
    expect(withAmount.json().error.fields).toEqual({ 'lines.0.amount': 'У перемещения нет суммы' });

    const other = (await w.h.req('POST', '/api/v1/companies', { name: 'ТОО Другое' })).json().company.id as number;
    const otherProject = (await w.post(`/api/v1/companies/${other}/projects`, { name: 'Клуб 9', templateKey: 'general' })).project.id as number;
    const foreign = (await w.post(`/api/v1/companies/${other}/stock/warehouses`, { projectId: otherProject, name: 'Бар Клуб 9' })).warehouse.id as number;
    const toForeign = await w.h.req('POST', `${w.stock}/docs`, { type: 'transfer', at: D2, warehouseId: w.wh, toWarehouseId: foreign, lines: [{ itemId: w.cola, qty: 1000 }] });
    expect(toForeign.statusCode).toBe(422);
    expect(toForeign.json().error).toMatchObject({ code: 'INVARIANT_5', fields: { toWarehouseId: 'Склад не найден в этой компании' } });

    expect((await w.h.req('POST', `${w.stock}/warehouses/${w.wh2}/archive`)).statusCode).toBe(200);
    const toArchived = await w.h.req('POST', `${w.stock}/docs`, { type: 'transfer', at: D2, warehouseId: w.wh, toWarehouseId: w.wh2, lines: [{ itemId: w.cola, qty: 1000 }] });
    expect(toArchived.statusCode).toBe(422);
    expect(toArchived.json().error.code).toBe('ARCHIVED_REFERENCE');
  });

  it('удаление поступления, из которого переместили, — 422, ничего не записано (Review Focus 2)', async () => {
    const w = await world();
    const receipt = await w.receipt(D1, [[w.cola, 3000, 30_000]]);
    await w.transfer(D2, w.wh, w.wh2, [[w.cola, 2000]]);
    const before = await Promise.all(['stock_docs', 'stock_batches', 'stock_allocations', 'audit_log'].map((t) => count(w, t)));
    const res = await w.h.req('DELETE', `${w.stock}/docs/${receipt.id}`);
    expect(res.statusCode).toBe(422);
    expect(res.json().error).toMatchObject({ code: 'INSUFFICIENT_STOCK', message: 'Не хватает «Кола 0,5»: на складе 0 шт на 02.10.2026' });
    expect(await Promise.all(['stock_docs', 'stock_batches', 'stock_allocations', 'audit_log'].map((t) => count(w, t)))).toEqual(before);
    expect((await w.h.req('GET', `${w.stock}/docs/${receipt.id}`)).json().doc.deletedAt).toBeNull();
  });

  it('dryRun перемещения ничего не пишет и показывает последствия', async () => {
    const w = await world();
    await w.receipt(D1, [[w.cola, 10_000, 100_000]]);
    await w.doc({ type: 'sale', at: D3, warehouseId: w.wh2, lines: [{ itemId: w.cola, qty: 1000, amount: 50_000 }] });
    const before = await Promise.all(['stock_docs', 'stock_batches', 'stock_allocations', 'audit_log'].map((t) => count(w, t)));
    const res = await w.h.req('POST', `${w.stock}/docs`, { type: 'transfer', at: D2, warehouseId: w.wh, toWarehouseId: w.wh2, lines: [{ itemId: w.cola, qty: 1000 }], dryRun: true });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ doc: null, impact: { sales: 1, writeoffs: 0, since: D2 } });
    expect(await Promise.all(['stock_docs', 'stock_batches', 'stock_allocations', 'audit_log'].map((t) => count(w, t)))).toEqual(before);
  });

  it('список: склад показывает и входящие перемещения (R6); фильтр по типу', async () => {
    const w = await world();
    await w.receipt(D1, [[w.cola, 10_000, 100_000]]);
    await w.transfer(D2, w.wh, w.wh2, [[w.cola, 1000]]);
    const q = async (query: string) => (await w.h.req('GET', `${w.stock}/docs?${query}`)).json().docs.map((d: any) => d.number);
    expect(await q(`warehouse=${w.wh2}`)).toEqual([`${M}-0001`]);
    expect(await q('type=transfer')).toEqual([`${M}-0001`]);
  });

  it('история: перемещение пишется сущностью stock_doc с получателем', async () => {
    const w = await world();
    await w.receipt(D1, [[w.cola, 10_000, 100_000]]);
    await w.transfer(D2, w.wh, w.wh2, [[w.cola, 1000]]);
    const row = (await w.h.t.q("SELECT diff FROM audit_log WHERE entity = 'stock_doc' AND action = 'create' ORDER BY id DESC LIMIT 1"))[0] as { diff: string };
    expect(JSON.parse(row.diff)).toMatchObject({ number: `${M}-0001`, type: 'transfer', warehouseId: w.wh, toWarehouseId: w.wh2 });
  });

  it('смена получателя перемещения пересчитывает прежний и новый склады; цепочка из трёх складов', async () => {
    const w = await world();
    const project3 = (await w.post(`/api/v1/companies/${w.cid}/projects`, { name: 'Клуб 3', templateKey: 'general' })).project.id as number;
    const wh3 = (await w.post(`${w.stock}/warehouses`, { projectId: project3, name: 'Бар Клуб 3' })).warehouse.id as number;
    await w.receipt(D1, [[w.cola, 10_000, 100_000]]);
    const t = await w.transfer(D2, w.wh, w.wh2, [[w.cola, 4000]]);
    const res = await w.h.req('PATCH', `${w.stock}/docs/${t.id}`, { version: t.version, toWarehouseId: wh3 });
    expect(res.statusCode, res.body).toBe(200);
    expect(await balanceOf(w, w.wh2, w.cola)).toMatchObject({ qty: 0, cost: 0 });
    expect(await balanceOf(w, wh3, w.cola)).toMatchObject({ qty: 4000, cost: 40_000 });
    expect(await count(w, 'stock_batches')).toBe(2);

    // Клуб 1 → Клуб 3 → Клуб 2: продажа на Клубе 2 берёт партию, пришедшую через два перемещения
    await w.transfer(D3, wh3, w.wh2, [[w.cola, 1000]]);
    const sale = await w.doc({ type: 'sale', at: D4, warehouseId: w.wh2, lines: [{ itemId: w.cola, qty: 1000, amount: 50_000 }] });
    expect(sale.lines[0]).toMatchObject({ cost: 10_000, uncovered: 0 });
    expect(await groupsOf(w.h.t.db, w.cid, [{ warehouseId: w.wh2, itemId: w.cola }])).toEqual([{ itemId: w.cola, warehouseIds: [w.wh, w.wh2, wh3].sort((a, b) => a - b) }]);
    // правка первого звена задним числом доходит до продажи на конце цепочки
    const first = (await w.h.req('GET', `${w.stock}/docs/${t.id}`)).json().doc;
    await w.h.req('PATCH', `${w.stock}/docs/${first.id}`, { version: first.version, lines: [{ itemId: w.cola, qty: 1000 }] });
    expect((await w.h.req('GET', `${w.stock}/docs/${sale.id}`)).json().doc.lines[0]).toMatchObject({ cost: 10_000, uncovered: 0 });
    const shrink = await w.h.req('PATCH', `${w.stock}/docs/${first.id}`, { version: first.version + 1, at: '2026-10-03T12:00:00.000Z' });
    expect(shrink.statusCode).toBe(422);
    expect(shrink.json().error.code).toBe('INSUFFICIENT_STOCK');
  });

  it('группы пересчёта: без перемещений — своя пара, с перемещением — оба склада (решение 4)', async () => {
    const w = await world();
    await w.receipt(D1, [[w.cola, 10_000, 100_000], [w.chips, 1000, 1000]]);
    const db = w.h.t.db;
    expect(await groupsOf(db, w.cid, [{ warehouseId: w.wh, itemId: w.cola }])).toEqual([{ itemId: w.cola, warehouseIds: [w.wh] }]);
    await w.transfer(D2, w.wh, w.wh2, [[w.cola, 1000]]);
    expect(await groupsOf(db, w.cid, [{ warehouseId: w.wh2, itemId: w.cola }])).toEqual([{ itemId: w.cola, warehouseIds: [w.wh, w.wh2].sort((a, b) => a - b) }]);
    // у чипсов перемещений нет — группа прежняя
    expect(await groupsOf(db, w.cid, [{ warehouseId: w.wh, itemId: w.chips }])).toEqual([{ itemId: w.chips, warehouseIds: [w.wh] }]);
  });
});
