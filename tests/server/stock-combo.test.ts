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

async function world(): Promise<StockWorld> {
  w = await stockWorld('2026-10-06T12:00:00.000Z');
  return w;
}

const balance = async (world: StockWorld) => ((await world.h.req('GET', `${world.stock}/balance?warehouse=${world.wh}`)).json().items as any[]);
const qtyOf = async (world: StockWorld, item: number) => (await balance(world)).find((i) => i.itemId === item)?.qty;
const sale = (world: StockWorld, at: string, item: number, qty: number, amount: number) => world.sale(at, [[item, qty, amount]]);
const fields = (res: { json(): any }) => res.json().error.fields;

describe('комплекты (§2, §5.2, Склад-2)', () => {
  it('продажа комплекта списывает составляющие по FIFO; комплекта нет в «Остатках»', async () => {
    const w = await world();
    const combo = await w.combo('Чипсы + кола', [[w.chips, 1000], [w.cola, 1000]], 1_500_000);
    await w.receipt(D1, [[w.cola, 10_000, 100_000], [w.chips, 10_000, 50_000]]);
    const doc = await sale(w, D2, combo, 2000, 3_000_000);
    expect(doc.lines[0]).toMatchObject({ itemId: combo, qty: 2000, amount: 3_000_000, cost: 30_000, uncovered: 0 });
    expect(await qtyOf(w, w.cola)).toBe(8000);
    expect(await qtyOf(w, w.chips)).toBe(8000);
    expect((await balance(w)).some((i) => i.itemId === combo)).toBe(false);
    const allocs = w.h.t.sqlite.prepare('SELECT component_item_id c, qty, cost FROM stock_allocations WHERE line_id = ? ORDER BY c').all(doc.lines[0].id);
    expect(allocs).toEqual(
      [
        { c: w.cola, qty: 2000, cost: 20_000 },
        { c: w.chips, qty: 2000, cost: 10_000 },
      ].sort((a, b) => a.c - b.c),
    );
    const item = (await w.h.req('GET', `${w.stock}/items/${combo}`)).json().item;
    expect(item).toMatchObject({ isCombo: true, hasDocs: true, parts: [{ itemId: w.chips, qty: 1000 }, { itemId: w.cola, qty: 1000 }] });
  });

  it('составляющая без остатка — «Нет партии»; поступление задним числом закрывает долг (Review Focus 4, R2)', async () => {
    const w = await world();
    const combo = await w.combo('Чипсы + кола', [[w.chips, 1000], [w.cola, 1000]]);
    await w.receipt(D1, [[w.cola, 10_000, 100_000]]);
    const doc = await sale(w, D2, combo, 2000, 3_000_000);
    expect(doc.lines[0]).toMatchObject({ cost: 20_000, uncovered: 2000 });
    // левая панель: на складе есть продажа без партии
    const value = (await w.h.req('GET', `${w.stock}/value`)).json();
    expect(value.warehouses.find((x: any) => x.warehouseId === w.wh).hasDeficit).toBe(true);
    // поступление чипсов ПОЗЖЕ продажи долг не закрывает и продажу не меняет
    const later = await w.h.req('POST', `${w.stock}/docs`, { type: 'receipt', at: D3, warehouseId: w.wh, lines: [{ itemId: w.chips, qty: 5000, amount: 25_000 }], dryRun: true });
    expect(later.json().impact).toEqual({ sales: 0, writeoffs: 0, since: null });
    // а раньше — закрывает
    const earlier = await w.h.req('POST', `${w.stock}/docs`, { type: 'receipt', at: D1, warehouseId: w.wh, lines: [{ itemId: w.chips, qty: 5000, amount: 25_000 }] });
    expect(earlier.statusCode, earlier.body).toBe(201);
    expect(earlier.json().impact).toEqual({ sales: 1, writeoffs: 0, since: D1 });
    expect((await w.h.req('GET', `${w.stock}/docs/${doc.id}`)).json().doc.lines[0]).toMatchObject({ cost: 30_000, uncovered: 0 });
    expect((await w.h.req('GET', `${w.stock}/value`)).json().warehouses.find((x: any) => x.warehouseId === w.wh).hasDeficit).toBe(false);
  });

  it('правила состава (решение 5)', async () => {
    const w = await world();
    const combo = await w.combo('Чипсы + кола', [[w.chips, 1000], [w.cola, 1000]]);
    const add = (body: Record<string, unknown>) => w.h.req('POST', `${w.stock}/items`, { name: 'Набор', unit: 'pcs', isCombo: true, ...body });
    const nested = await add({ parts: [{ itemId: combo, qty: 1000 }] });
    expect(nested.statusCode).toBe(422);
    expect(fields(nested)).toEqual({ 'parts.0.itemId': 'Комплект не может входить в другой комплект' });
    expect((await add({ parts: [] })).statusCode).toBe(400);
    expect(fields(await add({ parts: [] }))).toEqual({ parts: 'Добавьте хотя бы одну составляющую' });
    const dup = await add({ parts: [{ itemId: w.cola, qty: 1000 }, { itemId: w.cola, qty: 2000 }] });
    expect([dup.statusCode, fields(dup)]).toEqual([400, { 'parts.1.itemId': 'Товар уже есть в составе' }]);
    const liters = await add({ unit: 'l', parts: [{ itemId: w.cola, qty: 1000 }] });
    expect([liters.statusCode, fields(liters)]).toEqual([422, { unit: 'Комплект считается в штуках или упаковках' }]);
    const frac = await add({ parts: [{ itemId: w.cola, qty: 1500 }] });
    expect([frac.statusCode, fields(frac)]).toEqual([400, { 'parts.0.qty': 'Количество в штуках — целое' }]);
    expect((await add({ parts: [{ itemId: w.syrup, qty: 250 }] })).statusCode).toBe(201);
    const notCombo = await w.h.req('POST', `${w.stock}/items`, { name: 'Вода', unit: 'pcs', parts: [{ itemId: w.cola, qty: 1000 }] });
    expect([notCombo.statusCode, fields(notCombo)]).toEqual([400, { parts: 'Состав — только у комплекта' }]);
    const self = await w.h.req('PATCH', `${w.stock}/items/${combo}`, { parts: [{ itemId: combo, qty: 1000 }] });
    expect([self.statusCode, fields(self)]).toEqual([422, { 'parts.0.itemId': 'Комплект не может входить в другой комплект' }]);
    const foreign = await add({ name: 'Чужой', parts: [{ itemId: 99_999, qty: 1000 }] });
    expect([foreign.statusCode, foreign.json().error.code]).toEqual([422, 'INVARIANT_5']);
  });

  it('состав меняется только без документов; признак комплекта не меняется', async () => {
    const w = await world();
    const combo = await w.combo('Чипсы + кола', [[w.chips, 1000], [w.cola, 1000]]);
    const patch = (body: Record<string, unknown>) => w.h.req('PATCH', `${w.stock}/items/${combo}`, body);
    const ok = await patch({ parts: [{ itemId: w.cola, qty: 2000 }] });
    expect(ok.statusCode, ok.body).toBe(200);
    expect(ok.json().item.parts).toEqual([{ itemId: w.cola, qty: 2000 }]);
    const history = w.h.t.sqlite.prepare("SELECT diff FROM audit_log WHERE entity = 'stock_item' AND action = 'update' ORDER BY id DESC LIMIT 1").get() as { diff: string };
    expect(JSON.parse(history.diff)).toEqual({ before: { parts: ['Чипсы × 1', 'Кола 0,5 × 1'] }, after: { parts: ['Кола 0,5 × 2'] } });
    await w.receipt(D1, [[w.cola, 10_000, 100_000]]);
    await sale(w, D2, combo, 1000, 100_000);
    const locked = await patch({ parts: [{ itemId: w.cola, qty: 1000 }] });
    expect([locked.statusCode, locked.json().error.code, locked.json().error.message]).toEqual([422, 'INVARIANT_9', 'По комплекту есть документы — состав изменить нельзя']);
    expect((await patch({ isCombo: false })).statusCode).toBe(200);
    expect((await w.h.req('GET', `${w.stock}/items/${combo}`)).json().item.isCombo).toBe(true);
    const plain = await w.h.req('PATCH', `${w.stock}/items/${w.cola}`, { parts: [{ itemId: w.chips, qty: 1000 }] });
    expect([plain.statusCode, fields(plain)]).toEqual([400, { parts: 'Состав — только у комплекта' }]);
  });

  it('комплект только в продаже', async () => {
    const w = await world();
    const combo = await w.combo('Чипсы + кола', [[w.chips, 1000], [w.cola, 1000]]);
    const receipt = await w.h.req('POST', `${w.stock}/docs`, { type: 'receipt', at: D1, warehouseId: w.wh, lines: [{ itemId: combo, qty: 1000, amount: 1 }] });
    expect([receipt.statusCode, fields(receipt)]).toEqual([422, { 'lines.0.itemId': 'Комплект нельзя оприходовать — оприходуйте его составляющие' }]);
    const writeoff = await w.h.req('POST', `${w.stock}/docs`, { type: 'writeoff', at: D1, warehouseId: w.wh, reason: 'defect', lines: [{ itemId: combo, qty: 1000 }] });
    expect([writeoff.statusCode, fields(writeoff)]).toEqual([422, { 'lines.0.itemId': 'Комплект — только в продаже: используйте его составляющие' }]);
    const transfer = await w.h.req('POST', `${w.stock}/docs`, { type: 'transfer', at: D1, warehouseId: w.wh, toWarehouseId: w.wh2, lines: [{ itemId: combo, qty: 1000 }] });
    expect([transfer.statusCode, fields(transfer)]).toEqual([422, { 'lines.0.itemId': 'Комплект — только в продаже: используйте его составляющие' }]);
  });

  it('правка продажи: комплект → кола пересчитывает пары составляющих', async () => {
    const w = await world();
    const combo = await w.combo('Чипсы + кола', [[w.chips, 1000], [w.cola, 1000]]);
    await w.receipt(D1, [[w.cola, 10_000, 100_000], [w.chips, 10_000, 50_000]]);
    const doc = await sale(w, D2, combo, 2000, 3_000_000);
    const res = await w.h.req('PATCH', `${w.stock}/docs/${doc.id}`, { version: doc.version, lines: [{ itemId: w.cola, qty: 1000, amount: 50_000 }] });
    expect(res.statusCode, res.body).toBe(200);
    expect(await qtyOf(w, w.chips)).toBe(10_000);
    expect(await qtyOf(w, w.cola)).toBe(9000);
    expect(w.h.t.sqlite.prepare('SELECT COUNT(*) n FROM stock_allocations WHERE component_item_id IS NOT NULL').get()).toEqual({ n: 0 });
  });

  it('каталог (R3): удаление комплекта без документов удаляет состав; составляющую удалить и сменить ей единицу нельзя', async () => {
    const w = await world();
    const loose = await w.combo('Пустой набор', [[w.cola, 1000]]);
    expect((await w.h.req('DELETE', `${w.stock}/items/${loose}`)).statusCode).toBe(204);
    expect(w.h.t.sqlite.prepare('SELECT COUNT(*) n FROM stock_combo_parts WHERE combo_id = ?').get(loose)).toEqual({ n: 0 });

    await w.combo('Чипсы + кола', [[w.chips, 1000], [w.cola, 1000]]);
    const del = await w.h.req('DELETE', `${w.stock}/items/${w.chips}`);
    expect([del.statusCode, del.json().error.code, del.json().error.message]).toEqual([422, 'INVARIANT_9', 'Товар входит в комплект «Чипсы + кола» — уберите его из состава']);
    const unit = await w.h.req('PATCH', `${w.stock}/items/${w.chips}`, { unit: 'pack' });
    expect([unit.statusCode, fields(unit)]).toEqual([422, { unit: 'По товару есть документы' }]);
    // архивировать составляющую можно
    expect((await w.h.req('POST', `${w.stock}/items/${w.chips}/archive`)).statusCode).toBe(200);
  });
});
