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
const I = 'И'; // «И» — инвентаризация

async function world(): Promise<StockWorld> {
  w = await stockWorld('2026-10-06T12:00:00.000Z');
  return w;
}

const balanceOf = async (world: StockWorld, item: number) =>
  ((await world.h.req('GET', `${world.stock}/balance?warehouse=${world.wh}`)).json().items as any[]).find((i) => i.itemId === item);
const count = (world: StockWorld, table: string) => (world.h.t.sqlite.prepare(`SELECT COUNT(*) n FROM ${table}`).get() as { n: number }).n;
const get = async (world: StockWorld, id: number) => (await world.h.req('GET', `${world.stock}/docs/${id}`)).json().doc;

describe('инвентаризация (§7, Склад-2)', () => {
  it('черновик с fill: строки — товары с ненулевым остатком, учёт на дату; FIFO не меняется', async () => {
    const w = await world();
    await w.receipt(D1, [[w.cola, 10_000, 100_000], [w.chips, 5000, 25_000]]);
    await w.sale(D2, [[w.cola, 12_000, 600_000]]);
    const batches = count(w, 'stock_batches');
    const allocations = count(w, 'stock_allocations');
    const draft = await w.count(D3, [], { fill: true });
    expect(draft).toMatchObject({ number: `${I}-0001`, type: 'count', status: 'draft', warehouseId: w.wh, countSummary: null });
    // по названию: «Кола 0,5», «Чипсы»; сиропа нет — остаток 0. У колы партий нет, но есть долг «Нет партии» 2 шт:
    // учёт — остаток партий (0), долг — отдельно
    expect(draft.lines.map((l: any) => [l.itemId, l.expected, l.deficit, l.countedQty, l.qty])).toEqual([
      [w.cola, 0, 2000, null, 0],
      [w.chips, 5000, 0, null, 0],
    ]);
    expect([count(w, 'stock_batches'), count(w, 'stock_allocations')]).toEqual([batches, allocations]);
    expect(await balanceOf(w, w.cola)).toMatchObject({ qty: -2000 });
    // учёт черновика — на сейчас: поступление до даты черновика меняет его
    await w.receipt(D2, [[w.chips, 1000, 5000]]);
    expect((await get(w, draft.id)).lines[1].expected).toBe(6000);
  });

  it('проведение: недостача по FIFO, излишек по цене последней партии', async () => {
    const w = await world();
    await w.receipt(D1, [[w.cola, 3000, 36_000], [w.chips, 5000, 25_000]]);
    const draft = await w.count(D2, [
      [w.cola, 1000],
      [w.chips, 7000],
    ]);
    const posted = await w.postCount(draft);
    expect(posted).toMatchObject({ status: 'posted', version: draft.version + 1, countSummary: { shortage: 24_000, surplus: 10_000, unknownCost: 0 } });
    expect(posted.lines.map((l: any) => [l.itemId, l.expected, l.countedQty, l.qty])).toEqual([
      [w.cola, 3000, 1000, 2000],
      [w.chips, 5000, 7000, 2000],
    ]);
    const stored = w.h.t.sqlite.prepare('SELECT expected_qty e, qty FROM stock_doc_lines WHERE doc_id = ? ORDER BY position').all(draft.id);
    expect(stored).toEqual([
      { e: 3000, qty: 2000 },
      { e: 5000, qty: 2000 },
    ]);
    expect(await balanceOf(w, w.cola)).toMatchObject({ qty: 1000, cost: 12_000 });
    expect(await balanceOf(w, w.chips)).toMatchObject({ qty: 7000, cost: 35_000 });
    const history = w.h.t.sqlite.prepare("SELECT diff FROM audit_log WHERE entity = 'stock_doc' AND action = 'update' ORDER BY id DESC LIMIT 1").get() as { diff: string };
    expect(JSON.parse(history.diff)).toMatchObject({ number: `${I}-0001`, type: 'count', before: { status: 'draft' }, after: { status: 'posted' }, shortage: 24_000, surplus: 10_000 });
  });

  it('инвентаризация при долге «Нет партии»: стоимость не завышается, поздняя закупка не считается дважды (финальное ревью)', async () => {
    const w = await world();
    await w.receipt(D1, [[w.cola, 10_000, 1000]]);
    await w.sale(D2, [[w.cola, 12_000, 60_000]]);
    // полка пуста — факт 0; учёт — остаток партий 0, разницы нет
    const posted = await w.postCount(await w.count(D3, [[w.cola, 0]]));
    expect(posted.lines[0]).toMatchObject({ expected: 0, countedQty: 0, qty: 0 });
    expect(posted.countSummary).toEqual({ shortage: 0, surplus: 0, unknownCost: 0 });
    const cola = async () => ((await w.h.req('GET', `${w.stock}/balance?warehouse=${w.wh}`)).json().items as any[]).find((i) => i.itemId === w.cola);
    expect(await cola()).toMatchObject({ qty: -2000, cost: 0, deficit: 2000 });
    // недостающее поступление задним числом закрывает долг; остаток — 0, стоимость — 0, без двойного учёта
    await w.receipt('2026-10-01T09:00:00.000Z', [[w.cola, 2000, 200]]);
    expect(await cola()).toMatchObject({ qty: 0, cost: 0, deficit: 0 });
  });

  it('проведение черновика на складе, ушедшем в архив, — 422', async () => {
    const w = await world();
    const draft = await w.count(D2, [[w.cola, 0]]);
    expect((await w.h.req('POST', `${w.stock}/warehouses/${w.wh}/archive`)).statusCode).toBe(200);
    const res = await w.h.req('POST', `${w.stock}/docs/${draft.id}/post`, { version: draft.version });
    expect([res.statusCode, res.json().error.code]).toEqual([422, 'ARCHIVED_REFERENCE']);
  });

  it('излишек товара без партий — 0 и «цена неизвестна» (R7)', async () => {
    const w = await world();
    const posted = await w.postCount(await w.count(D2, [[w.syrup, 1500]]));
    expect(posted.countSummary).toEqual({ shortage: 0, surplus: 0, unknownCost: 1 });
    const syrup = await balanceOf(w, w.syrup);
    expect(syrup).toMatchObject({ qty: 1500, cost: 0 });
    expect(syrup.batches[0]).toMatchObject({ unknownCost: true, docNumber: `${I}-0001` });
  });

  it('без разницы — ни взятия, ни партии', async () => {
    const w = await world();
    await w.receipt(D1, [[w.cola, 3000, 36_000]]);
    const posted = await w.postCount(await w.count(D2, [[w.cola, 3000]]));
    expect(posted.countSummary).toEqual({ shortage: 0, surplus: 0, unknownCost: 0 });
    expect(posted.lines[0]).toMatchObject({ expected: 3000, countedQty: 3000, qty: 0 });
    expect(count(w, 'stock_batches')).toBe(1);
  });

  it('черновик правится и удаляется; проведённая — только удаляется, с пересчётом и dryRun', async () => {
    const w = await world();
    await w.receipt(D1, [[w.cola, 3000, 36_000]]);
    const draft = await w.count(D2, [[w.cola, null]]);
    const edit = await w.h.req('PATCH', `${w.stock}/docs/${draft.id}`, { version: draft.version, comment: 'бар', lines: [{ itemId: w.cola, countedQty: 2000 }] });
    expect(edit.statusCode, edit.body).toBe(200);
    expect(edit.json().doc).toMatchObject({ version: draft.version + 1, comment: 'бар', status: 'draft' });
    expect(edit.json().doc.lines[0]).toMatchObject({ countedQty: 2000, expected: 3000 });
    const moved = await w.h.req('PATCH', `${w.stock}/docs/${draft.id}`, { version: draft.version + 1, warehouseId: w.wh2 });
    expect([moved.statusCode, moved.json().error.fields]).toEqual([422, { warehouseId: 'Склад инвентаризации не меняется' }]);

    const posted = await w.postCount({ id: draft.id, version: draft.version + 1 });
    const locked = await w.h.req('PATCH', `${w.stock}/docs/${draft.id}`, { version: posted.version, comment: 'ещё' });
    expect([locked.statusCode, locked.json().error.message]).toEqual([422, 'Проведённую инвентаризацию изменить нельзя — удалите её и проведите заново']);
    const again = await w.h.req('POST', `${w.stock}/docs/${draft.id}/post`, { version: posted.version });
    expect([again.statusCode, again.json().error.message]).toEqual([422, 'Инвентаризация уже проведена']);

    const probe = await w.h.req('DELETE', `${w.stock}/docs/${draft.id}?dryRun=1`);
    expect(probe.json()).toEqual({ doc: null, impact: { sales: 0, writeoffs: 0, since: null } });
    expect((await w.h.req('DELETE', `${w.stock}/docs/${draft.id}`)).statusCode).toBe(200);
    expect(await balanceOf(w, w.cola)).toMatchObject({ qty: 3000, cost: 36_000 });

    const other = await w.count(D3, [[w.cola, 1000]]);
    expect((await w.h.req('DELETE', `${w.stock}/docs/${other.id}`)).statusCode).toBe(200);
    // история черновика: создание, правка, проведение (как правка статуса), удаление
    const actions = w.h.t.sqlite.prepare("SELECT action FROM audit_log WHERE entity = 'stock_doc' AND entity_id = ? ORDER BY id").all(draft.id) as { action: string }[];
    expect(actions.map((a) => a.action)).toEqual(['create', 'update', 'update', 'delete']);
    expect(w.h.auditCount('stock_doc', 'delete')).toBe(2);
  });

  it('у инвентаризации нет пробного расчёта', async () => {
    const w = await world();
    const res = await w.h.req('POST', `${w.stock}/docs`, { type: 'count', at: D2, warehouseId: w.wh, lines: [], dryRun: true });
    expect([res.statusCode, res.json().error.fields]).toEqual([400, { dryRun: 'У инвентаризации нет пробного расчёта' }]);
    expect(count(w, 'stock_docs')).toBe(0);
  });

  it('ошибки: пустой факт и пустой документ при проведении, комплект, повтор товара, дробные штуки, 409', async () => {
    const w = await world();
    await w.receipt(D1, [[w.cola, 3000, 36_000]]);
    const draft = await w.count(D2, [
      [w.cola, 1000],
      [w.chips, null],
    ]);
    const blank = await w.h.req('POST', `${w.stock}/docs/${draft.id}/post`, { version: draft.version });
    expect([blank.statusCode, blank.json().error.fields]).toEqual([422, { 'lines.1.countedQty': 'Внесите факт или удалите строку' }]);
    const empty = await w.count(D2, []);
    const none = await w.h.req('POST', `${w.stock}/docs/${empty.id}/post`, { version: empty.version });
    expect([none.statusCode, none.json().error.message]).toEqual([422, 'Добавьте хотя бы одну строку']);
    const stale = await w.h.req('POST', `${w.stock}/docs/${draft.id}/post`, { version: draft.version + 5 });
    expect([stale.statusCode, stale.json().error.code]).toEqual([409, 'VERSION_CONFLICT']);

    const combo = await w.combo('Чипсы + кола', [[w.chips, 1000], [w.cola, 1000]]);
    const withCombo = await w.h.req('POST', `${w.stock}/docs`, { type: 'count', at: D2, warehouseId: w.wh, lines: [{ itemId: combo, countedQty: 1000 }] });
    expect([withCombo.statusCode, withCombo.json().error.fields]).toEqual([422, { 'lines.0.itemId': 'Комплект — только в продаже: используйте его составляющие' }]);
    const twice = await w.h.req('POST', `${w.stock}/docs`, { type: 'count', at: D2, warehouseId: w.wh, lines: [{ itemId: w.cola, countedQty: 1000 }, { itemId: w.cola, countedQty: 2000 }] });
    expect([twice.statusCode, twice.json().error.fields]).toEqual([400, { 'lines.1.itemId': 'Товар уже есть в инвентаризации' }]);
    const frac = await w.h.req('POST', `${w.stock}/docs`, { type: 'count', at: D2, warehouseId: w.wh, lines: [{ itemId: w.cola, countedQty: 1500 }] });
    expect([frac.statusCode, frac.json().error.fields]).toEqual([400, { 'lines.0.countedQty': 'Количество в штуках — целое' }]);
    const future = await w.h.req('POST', `${w.stock}/docs`, { type: 'count', at: '2026-10-09T10:00:00.000Z', warehouseId: w.wh, lines: [] });
    expect([future.statusCode, future.json().error.code]).toEqual([422, 'INVARIANT_6']);
    // ноль — допустимый факт
    expect((await w.h.req('POST', `${w.stock}/docs`, { type: 'count', at: D2, warehouseId: w.wh, lines: [{ itemId: w.cola, countedQty: 0 }] })).statusCode).toBe(201);
  });

  it('правка прошлого после проведения (Review Focus 3)', async () => {
    const w = await world();
    const receipt = await w.receipt(D1, [[w.cola, 3000, 36_000]]);
    const posted = await w.postCount(await w.count(D3, [[w.cola, 1000]]));
    // цена более раннего поступления меняет себестоимость недостачи, а не её количество
    const repriced = await w.h.req('PATCH', `${w.stock}/docs/${receipt.id}`, { version: receipt.version, lines: [{ itemId: w.cola, qty: 3000, amount: 30_000 }] });
    expect(repriced.statusCode, repriced.body).toBe(200);
    expect(repriced.json().impact).toEqual({ sales: 0, writeoffs: 1, since: D1 });
    const after = await get(w, posted.id);
    expect(after.countSummary).toEqual({ shortage: 20_000, surplus: 0, unknownCost: 0 });
    expect(after.lines[0]).toMatchObject({ expected: 3000, qty: 2000 });
    // удаление поступления оставляет недостачу без остатка — 422, ничего не записано
    const del = await w.h.req('DELETE', `${w.stock}/docs/${receipt.id}`);
    expect([del.statusCode, del.json().error.code]).toEqual([422, 'INSUFFICIENT_STOCK']);
    // продажа задним числом до инвентаризации тоже не может «съесть» недостачу
    const sale = await w.h.req('POST', `${w.stock}/docs`, { type: 'sale', at: D2, warehouseId: w.wh, lines: [{ itemId: w.cola, qty: 2000, amount: 1 }] });
    expect([sale.statusCode, sale.json().error.code]).toEqual([422, 'INSUFFICIENT_STOCK']);
  });

  it('«Прибыль» со складом видит недостачу как списание', async () => {
    const w = await world();
    await w.receipt(D1, [[w.cola, 3000, 36_000]]);
    await w.postCount(await w.count(D4, [[w.cola, 1000]]));
    const res = await w.h.req('GET', `/api/v1/companies/${w.cid}/analytics/pnl?from=2026-10-01&to=2026-10-31&step=month&stock=1`);
    expect(res.statusCode, res.body).toBe(200);
    expect(JSON.stringify(res.json())).toContain('24000');
  });

  it('список: черновик и проведённая видны с типом и статусом; R15 — PATCH по типу документа', async () => {
    const w = await world();
    await w.count(D2, [[w.cola, null]]);
    const list = (await w.h.req('GET', `${w.stock}/docs?type=count`)).json().docs;
    expect(list).toEqual([expect.objectContaining({ number: `${I}-0001`, status: 'draft', total: 0, linesCount: 1 })]);
    // тело правки инвентаризации — своё: количество с суммой здесь не принимается
    const wrong = await w.h.req('PATCH', `${w.stock}/docs/${list[0].id}`, { version: 1, lines: [{ itemId: w.cola, qty: 1000, amount: 5 }] });
    expect(wrong.statusCode).toBe(400);
    expect((await w.h.req('PATCH', `${w.stock}/docs/99999`, { version: 1 })).statusCode).toBe(404);
  });
});
