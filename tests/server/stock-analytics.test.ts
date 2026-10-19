import { afterEach, describe, expect, it } from 'vitest';
import { stockWorld, type StockWorld } from '../helpers/stock';
import { sheetRows } from '../helpers/xlsx-rows';

let w: StockWorld | null = null;
afterEach(async () => {
  await w?.h.t.cleanup();
  w = null;
});

const Q3 = 'from=2026-07-01&to=2026-09-30';
const at = (day: string) => `${day}T06:00:00.000Z`;

async function world(): Promise<StockWorld> {
  w = await stockWorld('2026-10-06T12:00:00.000Z');
  return w;
}

/**
 * Третий квартал 2026 (синтетика, минимальные единицы): кола 10 шт на 100 000 (05.07) и 5 шт на 60 000 (05.08), чипсы 10 шт
 * на 50 000; продажа 12 колы на 720 000 (10.08), комплект «Чипсы + кола» 1 шт на 100 000 (20.08), списание колы 1 (01.09),
 * инвентаризация 10.09 (чипсы: факт 7 при учёте 9 — недостача 2; кола: факт 2 при учёте 1 — излишек 1), перемещение колы 1
 * в Клуб 2 (15.09). Цена продажи колы 50 000 с 01.06.
 */
async function quarter() {
  const s = await world();
  await s.post(`${s.stock}/items/${s.cola}/price`, { price: 50_000, validFrom: '2026-06-01' });
  const combo = await s.combo('Чипсы + кола', [
    [s.chips, 1000],
    [s.cola, 1000],
  ]);
  await s.receipt(at('2026-07-05'), [
    [s.cola, 10_000, 100_000],
    [s.chips, 10_000, 50_000],
  ]);
  await s.receipt(at('2026-08-05'), [[s.cola, 5000, 60_000]]);
  await s.sale(at('2026-08-10'), [[s.cola, 12_000, 720_000]]);
  await s.sale(at('2026-08-20'), [[combo, 1000, 100_000]]);
  await s.writeoff(at('2026-09-01'), [[s.cola, 1000]]);
  await s.postCount(
    await s.count(at('2026-09-10'), [
      [s.chips, 7000],
      [s.cola, 2000],
    ]),
  );
  await s.transfer(at('2026-09-15'), s.wh, s.wh2, [[s.cola, 1000]]);
  return { s, combo };
}

const get = async (world: StockWorld, url: string) => {
  const res = await world.h.req('GET', `${world.stock}/analytics/${url}`);
  expect(res.statusCode, res.body).toBe(200);
  return res.json();
};

describe('аналитика склада по товарам (§8, Склад-3)', () => {
  it('строки и итоги по всем складам; тождество «на начало + закуплено + излишки - себестоимость - потери = на конец»', async () => {
    const { s, combo } = await quarter();
    const r = await get(s, `items?${Q3}`);
    const row = (id: number) => r.rows.find((x: any) => x.itemId === id);
    expect(row(s.cola)).toEqual({
      itemId: s.cola,
      groupId: null,
      isCombo: false,
      soldQty: 12_000,
      revenue: 720_000,
      cost: 124_000,
      profit: 596_000,
      marginBp: 8278,
      lossQty: 1000,
      lossCost: 12_000,
      avgSalePrice: 60_000,
      avgPurchasePrice: 10_667,
      noBatchQty: 0,
    });
    // комплект — своей строкой; у колы нет его продаж
    expect(row(combo)).toMatchObject({ isCombo: true, soldQty: 1000, revenue: 100_000, cost: 17_000, profit: 83_000, marginBp: 8300, avgPurchasePrice: null });
    // чипсы не продавались напрямую: маржа и средняя цена — «—»
    expect(row(s.chips)).toMatchObject({ soldQty: 0, revenue: 0, marginBp: null, avgSalePrice: null, lossQty: 2000, lossCost: 10_000, avgPurchasePrice: 5000 });
    expect(r.totals).toEqual({ revenue: 820_000, cost: 141_000, profit: 679_000, losses: 22_000, surplus: 12_000, purchased: 210_000, valueStart: 0, valueEnd: 59_000, valueChange: 59_000 });
    const t = r.totals;
    expect(t.valueStart + t.purchased + t.surplus - t.cost - t.losses).toBe(t.valueEnd);
  });

  it('один склад: строки и стоимость только этого склада', async () => {
    const { s } = await quarter();
    const r = await get(s, `items?${Q3}&warehouse=${s.wh}`);
    expect(r.totals).toMatchObject({ revenue: 820_000, purchased: 210_000, valueStart: 0, valueEnd: 47_000 });
    const other = await get(s, `items?${Q3}&warehouse=${s.wh2}`);
    expect(other.rows).toEqual([]);
    expect(other.totals).toMatchObject({ revenue: 0, valueEnd: 12_000 });
  });

  it('тождество держится и после архивирования склада с историей (R4)', async () => {
    const { s } = await quarter();
    // Клуб 2 в архиве: его кола (12 000) остаётся в стоимости «всех складов» аналитики
    expect((await s.h.req('POST', `${s.stock}/warehouses/${s.wh2}/archive`)).statusCode).toBe(200);
    const t = (await get(s, `items?${Q3}`)).totals;
    expect(t.valueEnd).toBe(59_000);
    expect(t.valueStart + t.purchased + t.surplus - t.cost - t.losses).toBe(t.valueEnd);
  });

  it('продажа без партии — noBatchQty; период без движения — пусто', async () => {
    const s = await world();
    await s.sale(at('2026-09-20'), [[s.syrup, 1500, 3000]]);
    const r = await get(s, `items?${Q3}`);
    expect(r.rows).toEqual([expect.objectContaining({ itemId: s.syrup, soldQty: 1500, revenue: 3000, cost: 0, noBatchQty: 1500 })]);
    expect((await get(s, 'items?from=2026-01-01&to=2026-03-31')).rows).toEqual([]);
  });

  it('ошибки: начало позже конца — 400; склад другой компании — 422; товар другой компании — 404', async () => {
    const s = await world();
    const late = await s.h.req('GET', `${s.stock}/analytics/items?from=2026-09-30&to=2026-07-01`);
    expect([late.statusCode, late.json().error.fields]).toEqual([400, { from: 'Начало периода позже конца' }]);
    expect((await s.h.req('GET', `${s.stock}/analytics/items?${Q3}&warehouse=99999`)).json().error.code).toBe('INVARIANT_5');
    expect((await s.h.req('GET', `${s.stock}/analytics/prices/99999?${Q3}`)).statusCode).toBe(404);
  });
});

describe('списки «Мало», «Без движения», «Нет партии» (§8)', () => {
  it('по складу: ниже минимума, без продаж дольше N дней, продажи без партии', async () => {
    const s = await world();
    await s.h.req('PATCH', `${s.stock}/items/${s.chips}`, { minQty: 20_000 });
    await s.receipt(at('2026-08-01'), [
      [s.cola, 10_000, 100_000],
      [s.chips, 10_000, 50_000],
    ]);
    await s.sale(at('2026-09-30'), [[s.cola, 1000, 50_000]]);
    await s.sale(at('2026-09-20'), [[s.syrup, 1500, 3000]]);
    const r = await get(s, `lists?warehouse=${s.wh}`);
    expect(r.low).toEqual([{ itemId: s.chips, qty: 10_000, minQty: 20_000 }]);
    // кола продавалась 6 дней назад; чипсы не продавались, последнее движение — поступление 01.08
    expect(r.stale).toEqual([{ itemId: s.chips, qty: 10_000, lastMoveAt: at('2026-08-01') }]);
    expect(r.noBatch).toEqual([{ itemId: s.syrup, qty: 1500, since: at('2026-09-20') }]);
    // окно «Без движения» 3 дня — кола тоже
    expect((await get(s, `lists?warehouse=${s.wh}&days=3`)).stale.map((x: any) => x.itemId).sort()).toEqual([s.cola, s.chips].sort((a, b) => a - b));
    expect((await s.h.req('GET', `${s.stock}/analytics/lists?days=0`)).statusCode).toBe(400);
  });
});

describe('движение товара в списках и строках', () => {
  it('продажа в составе комплекта и перемещение на склад — движение; товар только с излишком — своя строка', async () => {
    const s = await world();
    const combo = await s.combo('Чипсы + кола', [[s.chips, 1000]]);
    await s.receipt(at('2026-07-01'), [
      [s.chips, 10_000, 50_000],
      [s.cola, 10_000, 100_000],
    ]);
    // чипсы уходят только в комплекте, кола приходит на Клуб 2 перемещением
    await s.sale(at('2026-10-01'), [[combo, 1000, 1000]]);
    await s.transfer(at('2026-10-02'), s.wh, s.wh2, [[s.cola, 1000]]);
    const club1 = await get(s, `lists?warehouse=${s.wh}`);
    expect(club1.stale.map((x: any) => x.itemId)).toEqual([s.cola]);
    const club2 = await get(s, `lists?warehouse=${s.wh2}`);
    expect(club2.stale).toEqual([]);
    // излишек сиропа (цены нет) — строка сиропа с потерями и продажами по нулям
    await s.postCount(await s.count(at('2026-09-10'), [[s.syrup, 500]]));
    const rows = (await get(s, `items?${Q3}`)).rows;
    expect(rows.find((r: any) => r.itemId === s.syrup)).toMatchObject({ soldQty: 0, lossCost: 0 });
  });
});

describe('динамика цен и подсказка о марже (§8)', () => {
  it('точки закупки, ступени цены продажи, маржа; «Закупка выросла на 20% … маржа упала до 76%»', async () => {
    const { s, combo } = await quarter();
    const p = await get(s, `prices/${s.cola}?${Q3}`);
    expect(p.purchases).toEqual([
      { at: at('2026-07-05'), docId: expect.any(Number), docNumber: 'П-0001', unitCost: 10_000 },
      { at: at('2026-08-05'), docId: expect.any(Number), docNumber: 'П-0002', unitCost: 12_000 },
    ]);
    expect(p.salePrices).toEqual([
      { validFrom: '2026-06-01', price: 50_000 },
      { validFrom: '2026-10-06', price: 50_000 },
    ]);
    expect(p.margins).toEqual([
      { at: at('2026-07-05'), marginBp: 8000 },
      { at: at('2026-08-05'), marginBp: 7600 },
    ]);
    expect(p.hint).toBe('Закупка выросла на 20% с 05.08.2026, маржа упала до 76%');
    // комплект не закупается — точек и подсказки нет
    const c = await get(s, `prices/${combo}?${Q3}`);
    expect([c.purchases, c.hint]).toEqual([[], null]);
  });

  it('цена продажи поднята после прежней закупки — подсказки нет; смена цены — точка маржи', async () => {
    const { s } = await quarter();
    await s.post(`${s.stock}/items/${s.cola}/price`, { price: 60_000, validFrom: '2026-08-10' });
    const p = await get(s, `prices/${s.cola}?${Q3}`);
    expect(p.hint).toBeNull();
    // смена цены — начало дня по часам компании (Алматы, UTC+5)
    expect(p.margins).toContainEqual({ at: '2026-08-09T19:00:00.000Z', marginBp: 8000 });
  });
});

describe('выгрузка в Excel (§8)', () => {
  it('лист «Товары» с периодом над заголовками, строкой «Итого»; имя — как у отчётов «Аналитики»', async () => {
    const { s } = await quarter();
    const res = await s.h.req('GET', `${s.stock}/analytics/export.xlsx?${Q3}`);
    expect(res.statusCode).toBe(200);
    expect(decodeURIComponent(String(res.headers['content-disposition']))).toMatch(/ТОО - Аналитика склада - 06-10-2026 17-00\.xlsx/);
    const rows = sheetRows(res.rawPayload);
    expect(rows[0]![0]).toBe('Период: 01.07.2026 – 30.09.2026');
    expect(rows[1]![0]).toBe('Склад: все склады');
    const head = rows.findIndex((r) => r[0] === 'Группа');
    expect(rows[head]).toEqual([
      'Группа',
      'Товар',
      'Продано',
      'Выручка',
      'Себестоимость',
      'Прибыль',
      'Маржа, %',
      'Списано и недостача',
      'Средняя цена продажи',
      'Средняя цена закупки',
      'Без партии',
    ]);
    expect(rows.some((r) => r[1] === 'Кола 0,5')).toBe(true);
    expect(rows.at(-1)?.slice(0, 2)).toEqual(['', 'Итого']);
  });
});
