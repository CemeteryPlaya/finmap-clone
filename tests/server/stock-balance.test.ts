import { afterEach, describe, expect, it } from 'vitest';
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

async function world(): Promise<StockWorld> {
  w = await stockWorld('2026-10-06T12:00:00.000Z');
  return w;
}

const balance = async (world: StockWorld, query = '') => (await world.h.req('GET', `${world.stock}/balance${query}`)).json();
const itemRow = (b: any, id: number) => b.items.find((i: any) => i.itemId === id);

describe('остатки', () => {
  it('товар: остаток, стоимость, средняя закупка, наценка и партии с номером документа и поставщиком', async () => {
    const w = await world();
    const r1 = await w.receipt(D1, [[w.cola, 10_000, 100_000]]); // 10,00 за шт
    await w.receipt(D2, [[w.cola, 10_000, 150_000]]); // 15,00 за шт
    await w.sale(D3, [[w.cola, 12_000, 600_000]]);
    const b = await balance(w);
    expect(itemRow(b, w.cola)).toMatchObject({
      qty: 8000,
      qtyLeft: 8000,
      deficit: 0,
      cost: 120_000,
      avgCost: 15_000,
      salePrice: 50_000,
      markupBp: 23_333, // (500 \u2212 150) / 150 = 233,33 %
      low: false,
    });
    expect(itemRow(b, w.cola).batches).toEqual([
      { lineId: expect.any(Number), docId: expect.any(Number), docNumber: 'П-0002', warehouseId: w.wh, counterpartyId: w.supplier, at: D2, qtyIn: 10_000, costIn: 150_000, qtyLeft: 8000, costLeft: 120_000 },
    ]);
    expect(b.total).toBe(120_000);
    expect(r1.number).toBe('П-0001');
    // товары без движения тоже в списке, с нулями
    expect(itemRow(b, w.chips)).toMatchObject({ qty: 0, cost: 0, avgCost: null, markupBp: null, batches: [] });
  });

  it('продажа без партии: остаток отрицательный, «Нет партии» через deficit', async () => {
    const w = await world();
    await w.receipt(D1, [[w.cola, 1000, 10_000]]);
    await w.sale(D2, [[w.cola, 3000, 150_000]]);
    expect(itemRow(await balance(w), w.cola)).toMatchObject({ qty: -2000, qtyLeft: 0, deficit: 2000, cost: 0, avgCost: null });
    // долг закрывается поступлением с более ранней датой
    await w.receipt(D1, [[w.cola, 5000, 50_000]]);
    expect(itemRow(await balance(w), w.cola)).toMatchObject({ qty: 3000, deficit: 0, cost: 30_000 });
  });

  it('поздняя приёмка не закрывает долг сама (R2): deficit, deficitAt и hasDeficit видны, пока поступление не перенесено', async () => {
    const w = await world();
    const sale = await w.sale(D2, [[w.cola, 2000, 100_000]]); // «день 10»
    const receipt = await w.receipt(D4, [[w.cola, 5000, 50_000]]); // «день 12»
    const row = itemRow(await balance(w), w.cola);
    expect(row).toMatchObject({ qty: 3000, qtyLeft: 5000, deficit: 2000, deficitAt: D2, cost: 50_000 });
    expect(itemRow(await balance(w), w.chips).deficitAt).toBeNull();
    const value = (await w.h.req('GET', `${w.stock}/value`)).json();
    expect(value.warehouses[0]).toMatchObject({ warehouseId: w.wh, value: 50_000, hasDeficit: true });
    expect(value.warehouses[1]).toMatchObject({ warehouseId: w.wh2, hasDeficit: false });
    expect((await w.h.req('GET', `${w.stock}/docs/${sale.id}`)).json().doc.lines[0]).toMatchObject({ cost: null, uncovered: 2000 });
    // поступление переносим на «день 9» — раньше продажи
    const moved = await w.h.req('PATCH', `${w.stock}/docs/${receipt.id}`, { version: 1, at: D1 });
    expect(moved.statusCode).toBe(200);
    expect(itemRow(await balance(w), w.cola)).toMatchObject({ qty: 3000, qtyLeft: 3000, deficit: 0, deficitAt: null, cost: 30_000 });
    expect((await w.h.req('GET', `${w.stock}/value`)).json().warehouses[0]).toMatchObject({ value: 30_000, hasDeficit: false });
    expect((await w.h.req('GET', `${w.stock}/docs/${sale.id}`)).json().doc.lines[0]).toMatchObject({ cost: 20_000, uncovered: 0 });
  });

  it('«Мало»: остаток ниже минимального, в том числе нулевой и отрицательный', async () => {
    const w = await world();
    await w.h.req('PATCH', `${w.stock}/items/${w.cola}`, { minQty: 5000 });
    await w.receipt(D1, [[w.cola, 6000, 60_000]]);
    expect(itemRow(await balance(w), w.cola).low).toBe(false);
    await w.sale(D2, [[w.cola, 2000, 100_000]]);
    expect(itemRow(await balance(w), w.cola).low).toBe(true);
    expect(itemRow(await balance(w), w.chips).low).toBe(false); // минимум не задан
  });

  it('склад: отбор по складу и сумма по всем', async () => {
    const w = await world();
    await w.receipt(D1, [[w.cola, 4000, 40_000]]);
    await w.doc({ type: 'receipt', at: D1, warehouseId: w.wh2, lines: [{ itemId: w.cola, qty: 6000, amount: 90_000 }] });
    const all = await balance(w);
    expect([itemRow(all, w.cola).qty, itemRow(all, w.cola).cost, itemRow(all, w.cola).batches.length, all.total]).toEqual([10_000, 130_000, 2, 130_000]);
    const one = await balance(w, `?warehouse=${w.wh2}`);
    expect([itemRow(one, w.cola).qty, one.total, one.warehouseId]).toEqual([6000, 90_000, w.wh2]);
  });

  it('на дату: состояние на конец дня и цена продажи на ту дату', async () => {
    const w = await world();
    await w.receipt(D1, [[w.cola, 10_000, 100_000]]);
    await w.sale(D3, [[w.cola, 4000, 200_000]]);
    await w.h.req('POST', `${w.stock}/items/${w.cola}/price`, { price: 40_000, validFrom: '2026-09-01' });
    await w.h.req('POST', `${w.stock}/items/${w.cola}/price`, { price: 55_000, validFrom: '2026-10-03' });
    // история цены: 40,00 с 01.09, 500,00 с 06.10 (первая цена товара), 55,00 с 03.10
    const day2 = await balance(w, '?at=2026-10-02');
    expect(itemRow(day2, w.cola)).toMatchObject({ qty: 10_000, cost: 100_000, salePrice: 40_000 });
    expect(day2.at).toBe('2026-10-02');
    // продажа 3-го по UTC в 10:00 — это 15:00 по Алматы того же дня: конец дня 3-го её включает
    expect(itemRow(await balance(w, '?at=2026-10-03'), w.cola)).toMatchObject({ qty: 6000, cost: 60_000, salePrice: 55_000 });
    expect(itemRow(await balance(w, '?at=2026-09-30'), w.cola)).toMatchObject({ qty: 0, cost: 0, salePrice: 40_000 });
    expect(itemRow(await balance(w, '?at=2026-08-31'), w.cola)).toMatchObject({ qty: 0, salePrice: 0 });
    expect((await w.h.req('GET', `${w.stock}/balance?at=2026-13-01`)).statusCode).toBe(400);
  });

  it('архивный товар виден, только пока есть остаток или долг', async () => {
    const w = await world();
    await w.receipt(D1, [[w.chips, 1000, 10_000]]);
    await w.h.req('POST', `${w.stock}/items/${w.cola}/archive`);
    expect(itemRow(await balance(w), w.cola)).toBeUndefined();
    await w.h.req('POST', `${w.stock}/items/${w.chips}/archive`);
    expect(itemRow(await balance(w), w.chips)).toMatchObject({ qty: 1000 });
  });

  it('удалённые документы в остатки не входят', async () => {
    const w = await world();
    const r = await w.receipt(D1, [[w.cola, 4000, 40_000]]);
    await w.h.req('DELETE', `${w.stock}/docs/${r.id}`);
    expect(itemRow(await balance(w), w.cola)).toMatchObject({ qty: 0, cost: 0, batches: [] });
  });
});

describe('стоимость складов и левая панель (§4.4)', () => {
  it('стоимость по складам = сумма остатков партий; архивный склад не показывается', async () => {
    const w = await world();
    await w.receipt(D1, [[w.cola, 10_000, 100_000]]);
    await w.sale(D2, [[w.cola, 2000, 100_000]]);
    await w.doc({ type: 'receipt', at: D1, warehouseId: w.wh2, lines: [{ itemId: w.chips, qty: 1000, amount: 7777 }] });
    const v = (await w.h.req('GET', `${w.stock}/value`)).json();
    expect(v).toEqual({
      warehouses: [
        { warehouseId: w.wh, projectId: w.project, name: 'Бар Клуб 1', value: 80_000, hasDeficit: false },
        { warehouseId: w.wh2, projectId: w.project2, name: 'Бар Клуб 2', value: 7777, hasDeficit: false },
      ],
      total: 87_777,
    });
    expect(v.total).toBe((await balance(w)).total); // сохранённые партии и расчёт по документам сходятся
    await w.h.req('POST', `${w.stock}/warehouses/${w.wh2}/archive`);
    expect((await w.h.req('GET', `${w.stock}/value`)).json().total).toBe(80_000);
  });

  it('склад не входит в «Всего на счетах» и не меняет балансы счетов', async () => {
    const w = await world();
    const before = (await w.h.req('GET', `/api/v1/companies/${w.cid}/balances`)).json();
    await w.receipt(D1, [[w.cola, 10_000, 100_000]]);
    await w.sale(D2, [[w.cola, 2000, 100_000]]);
    const after = (await w.h.req('GET', `/api/v1/companies/${w.cid}/balances`)).json();
    expect(after).toEqual(before);
    expect(after.total.amount).toBe(0);
    expect((await w.h.req('GET', `${w.stock}/value`)).json().total).toBe(80_000);
  });
});

describe('итог остатков и архивные склады (R11)', () => {
  it('без фильтра по складу итог не включает архивные склады и совпадает с «Стоимость складов»; по архивному складу явно — считается', async () => {
    const w = await world();
    await w.receipt(D1, [[w.cola, 10_000, 100_000]]);
    await w.doc({ type: 'receipt', at: D1, warehouseId: w.wh2, counterpartyId: w.supplier, lines: [{ itemId: w.cola, qty: 5000, amount: 40_000 }] });
    expect((await balance(w)).total).toBe(140_000);
    await w.h.req('POST', `${w.stock}/warehouses/${w.wh2}/archive`);
    const all = await balance(w);
    expect([all.total, itemRow(all, w.cola).qty]).toEqual([100_000, 10_000]);
    expect(all.total).toBe((await w.h.req('GET', `${w.stock}/value`)).json().total);
    expect((await balance(w, `?warehouse=${w.wh2}`)).total).toBe(40_000);
  });
});
