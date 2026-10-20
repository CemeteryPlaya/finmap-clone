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

const patch = (world: StockWorld, id: number, body: Record<string, unknown>) => world.h.req('PATCH', `${world.stock}/docs/${id}`, body);
const getDoc = async (world: StockWorld, id: number) => (await world.h.req('GET', `${world.stock}/docs/${id}`)).json().doc;
const rows = async <T>(world: StockWorld, sql: string, ...args: unknown[]) => (await world.h.t.q(sql, ...args)) as T[];

describe('правка документа: версия и 409', () => {
  it('правка увеличивает версию и пишет историю с изменёнными полями', async () => {
    const w = await world();
    const r = await w.receipt(D1, [[w.cola, 10_000, 100_000]]);
    const res = await patch(w, r.id, { version: 1, comment: ' пересчитали ', lines: [{ itemId: w.cola, qty: 8000, amount: 96_000 }] });
    expect(res.statusCode).toBe(200);
    expect(res.json().doc).toMatchObject({ version: 2, comment: 'пересчитали', total: 96_000, lines: [{ qty: 8000, amount: 96_000 }] });
    expect(res.json().impact).toEqual({ sales: 0, writeoffs: 0, since: null });
    const audit = await rows<{ diff: string }>(w, "SELECT diff FROM audit_log WHERE entity = 'stock_doc' AND action = 'update'");
    expect(audit).toHaveLength(1);
    const diff = JSON.parse(audit[0]!.diff);
    expect(diff.after.comment).toBe('пересчитали');
    expect(diff.before.lines).toEqual([{ itemId: w.cola, qty: 10_000, amount: 100_000 }]);
  });

  it('две вкладки: вторая правка со старой версией — 409, документ остаётся как после первой', async () => {
    const w = await world();
    const r = await w.receipt(D1, [[w.cola, 10_000, 100_000]]);
    const first = await patch(w, r.id, { version: 1, comment: 'первая вкладка' });
    expect(first.statusCode).toBe(200);
    const second = await patch(w, r.id, { version: 1, comment: 'вторая вкладка' });
    expect([second.statusCode, second.json().error.code]).toEqual([409, 'VERSION_CONFLICT']);
    expect(await getDoc(w, r.id)).toMatchObject({ comment: 'первая вкладка', version: 2 });
    expect(await w.h.auditCount('stock_doc', 'update')).toBe(1);
  });

  it('удалённый документ править нельзя — 409', async () => {
    const w = await world();
    const r = await w.receipt(D1, [[w.cola, 1000, 100]]);
    await w.h.req('DELETE', `${w.stock}/docs/${r.id}`);
    const res = await patch(w, r.id, { version: 2, comment: 'x' });
    expect([res.statusCode, res.json().error.code]).toEqual([409, 'VERSION_CONFLICT']);
  });

  it('те же значения — без записи: версия и история прежние', async () => {
    const w = await world();
    const r = await w.receipt(D1, [[w.cola, 1000, 100]], { comment: 'тот же' });
    const res = await patch(w, r.id, { version: 1, comment: 'тот же', at: D1, counterpartyId: w.supplier, lines: [{ itemId: w.cola, qty: 1000, amount: 100 }] });
    expect(res.statusCode).toBe(200);
    expect(res.json().doc.version).toBe(1);
    expect(await w.h.auditCount('stock_doc', 'update')).toBe(0);
  });

  it('чужая компания — 404; тип документа не меняется; неверная версия и пустая правка — 400', async () => {
    const w = await world();
    const r = await w.receipt(D1, [[w.cola, 1000, 100]]);
    const other = (await w.h.req('POST', '/api/v1/companies', { name: 'ТОО Другое' })).json().company.id as number;
    expect((await w.h.req('PATCH', `/api/v1/companies/${other}/stock/docs/${r.id}`, { version: 1, comment: 'x' })).statusCode).toBe(404);
    expect((await patch(w, r.id, { comment: 'без версии' })).statusCode).toBe(400);
    await patch(w, r.id, { version: 1, type: 'sale', comment: 'тип игнорируется' });
    expect((await getDoc(w, r.id)).type).toBe('receipt');
  });
});

describe('правка прошлого: пересчёт последующих продаж (§5.4)', () => {
  it('сумма закупки и дата поступления меняют себестоимость продажи; в ответе — сколько продаж затронуто', async () => {
    const w = await world();
    const r = await w.receipt(D1, [[w.cola, 10_000, 100_000]]);
    const s = await w.sale(D3, [[w.cola, 4000, 200_000]]);
    expect((await getDoc(w, s.id)).lines[0].cost).toBe(40_000);
    const cost = await patch(w, r.id, { version: 1, lines: [{ itemId: w.cola, qty: 10_000, amount: 200_000 }] });
    expect(cost.json().impact).toEqual({ sales: 1, writeoffs: 0, since: D1 });
    expect((await getDoc(w, s.id)).lines[0].cost).toBe(80_000);
    // перенос поступления на дату после продажи — продажа остаётся без партии
    const moved = await patch(w, r.id, { version: 2, at: D4 });
    expect(moved.json().impact).toEqual({ sales: 1, writeoffs: 0, since: D1 }); // с меньшей из старой и новой дат
    expect((await getDoc(w, s.id)).lines[0]).toMatchObject({ cost: null, uncovered: 4000 });
    // и обратно
    await patch(w, r.id, { version: 3, at: D2 });
    expect((await getDoc(w, s.id)).lines[0]).toMatchObject({ cost: 80_000, uncovered: 0 });
  });

  it('перенос самой продажи на дату после поступления закрывает долг', async () => {
    const w = await world();
    await w.receipt(D3, [[w.cola, 10_000, 100_000]]);
    const s = await w.sale(D1, [[w.cola, 4000, 200_000]]);
    expect((await getDoc(w, s.id)).lines[0]).toMatchObject({ cost: null, uncovered: 4000 });
    const res = await patch(w, s.id, { version: 1, at: D4 });
    expect(res.json().impact).toEqual({ sales: 0, writeoffs: 0, since: null }); // чужих продаж нет — предупреждать не о чём
    expect((await getDoc(w, s.id)).lines[0]).toMatchObject({ cost: 40_000, uncovered: 0 });
  });

  it('предупреждение считает и списания; продажа с несколькими изменившимися строками — одна', async () => {
    const w = await world();
    await w.receipt(D2, [[w.cola, 10_000, 100_000], [w.chips, 10_000, 100_000]]);
    await w.writeoff(D3, [[w.cola, 1000]]);
    await w.sale(D3, [[w.cola, 1000, 50_000], [w.chips, 1000, 50_000]]);
    const res = await w.post(`${w.stock}/docs`, {
      type: 'receipt',
      at: D1,
      warehouseId: w.wh,
      lines: [{ itemId: w.cola, qty: 2000, amount: 180_000 }, { itemId: w.chips, qty: 1000, amount: 90_000 }],
    });
    expect(res.impact).toEqual({ sales: 1, writeoffs: 1, since: D1 });
  });

  it('dryRun правки считает последствия и ничего не пишет', async () => {
    const w = await world();
    const r = await w.receipt(D1, [[w.cola, 10_000, 100_000]]);
    const s = await w.sale(D3, [[w.cola, 4000, 200_000]]);
    const res = await patch(w, r.id, { version: 1, lines: [{ itemId: w.cola, qty: 10_000, amount: 300_000 }], dryRun: true });
    expect(res.json()).toEqual({ doc: null, impact: { sales: 1, writeoffs: 0, since: D1 } });
    expect(await getDoc(w, r.id)).toMatchObject({ version: 1, total: 100_000 });
    expect((await getDoc(w, s.id)).lines[0].cost).toBe(40_000);
    expect(await w.h.auditCount('stock_doc', 'update')).toBe(0);
  });

  it('правка продажи, из-за которой следующему ручному списанию не хватит, — 422 и откат', async () => {
    const w = await world();
    await w.receipt(D1, [[w.cola, 5000, 50_000]]);
    const s = await w.sale(D2, [[w.cola, 1000, 50_000]]);
    await w.writeoff(D3, [[w.cola, 4000]]); // как раз весь остаток
    const res = await patch(w, s.id, { version: 1, lines: [{ itemId: w.cola, qty: 2000, amount: 100_000 }] });
    expect(res.statusCode).toBe(422);
    expect(res.json().error).toMatchObject({ code: 'INSUFFICIENT_STOCK', message: 'Не хватает «Кола 0,5»: на складе 3 шт на 03.10.2026' });
    expect(await getDoc(w, s.id)).toMatchObject({ version: 1, total: 50_000 });
    expect(await rows(w, 'SELECT qty_left q, cost_left c FROM stock_batches')).toEqual([{ q: 0, c: 0 }]);
  });

  it('смена склада переносит движение: старая пара освобождается, новая получает партию', async () => {
    const w = await world();
    const r = await w.receipt(D1, [[w.cola, 4000, 40_000]]);
    await patch(w, r.id, { version: 1, warehouseId: w.wh2 });
    expect(await rows(w, 'SELECT warehouse_id w, qty_left q FROM stock_batches')).toEqual([{ w: w.wh2, q: 4000 }]);
    const res = await w.h.req('POST', `${w.stock}/docs`, { type: 'writeoff', at: D2, warehouseId: w.wh, reason: 'defect', lines: [{ itemId: w.cola, qty: 1000 }] });
    expect(res.json().error.code).toBe('INSUFFICIENT_STOCK'); // на прежнем складе товара уже нет
  });

  it('смена товара в строке пересчитывает обе пары', async () => {
    const w = await world();
    const r = await w.receipt(D1, [[w.cola, 4000, 40_000]]);
    const s = await w.sale(D2, [[w.cola, 1000, 50_000]]);
    expect((await getDoc(w, s.id)).lines[0].cost).toBe(10_000);
    await patch(w, r.id, { version: 1, lines: [{ itemId: w.chips, qty: 4000, amount: 40_000 }] });
    expect((await getDoc(w, s.id)).lines[0]).toMatchObject({ cost: null, uncovered: 1000 });
    expect(await rows(w, 'SELECT item_id i, qty_left q FROM stock_batches')).toEqual([{ i: w.chips, q: 4000 }]);
  });
});
