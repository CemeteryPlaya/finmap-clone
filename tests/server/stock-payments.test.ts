import { afterEach, describe, expect, it } from 'vitest';
import type { AccountMapping } from '../../src/shared/schemas/imports';
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
const PAID = '2026-10-05T10:00:00.000Z';

async function world(): Promise<StockWorld> {
  w = await stockWorld('2026-10-06T12:00:00.000Z');
  return w;
}

/** Расход поставщику со счёта «Касса» (KZT). */
const expenseBody = (world: StockWorld, over: Record<string, unknown> = {}) => ({
  type: 'expense',
  paidAt: PAID,
  accountId: world.kzt,
  amount: 100_000,
  counterpartyId: world.supplier,
  lines: [{ categoryId: world.expense, projectId: world.project, amount: 100_000 }],
  ...over,
});
const expense = (world: StockWorld, over: Record<string, unknown> = {}) => world.h.req('POST', world.ops, expenseBody(world, over));
const getDoc = async (world: StockWorld, id: number) => (await world.h.req('GET', `${world.stock}/docs/${id}`)).json().doc;
const unpaid = async (world: StockWorld, query = '') => (await world.h.req('GET', `${world.stock}/suppliers/${world.supplier}/unpaid${query}`)).json();

describe('оплата закупки из расхода журнала (§6.1)', () => {
  it('расход оплачивает часть поступления: у документа — оплачено и операция, у расхода — номера документов', async () => {
    const w = await world();
    const r = await w.receipt(D1, [[w.cola, 10_000, 250_000]]);
    const res = await expense(w, { stockPayments: [{ docId: r.id, amount: 100_000 }] });
    expect(res.statusCode).toBe(201);
    const op = res.json().operation;
    expect(op.stockPayments).toEqual([{ docId: r.id, number: 'П-0001', amount: 100_000 }]);
    const doc = await getDoc(w, r.id);
    expect(doc).toMatchObject({ total: 250_000, paid: 100_000, payments: [{ operationId: op.id, amount: 100_000, paidAt: PAID }] });
    const list = (await w.h.req('GET', `${w.stock}/docs`)).json().docs[0];
    expect([list.total, list.paid]).toEqual([250_000, 100_000]);
    expect((await w.h.req('GET', `${w.ops}/${op.id}`)).json().operation.stockPayments).toHaveLength(1);
    expect(w.h.auditCount('operation', 'create')).toBe(1);
  });

  it('несколько документов одним расходом; один документ несколькими расходами; долг считается по всем', async () => {
    const w = await world();
    const r1 = await w.receipt(D1, [[w.cola, 1000, 60_000]]);
    const r2 = await w.receipt(D2, [[w.chips, 1000, 90_000]]);
    await expense(w, { amount: 100_000, lines: [{ categoryId: w.expense, projectId: w.project, amount: 100_000 }], stockPayments: [{ docId: r1.id, amount: 60_000 }, { docId: r2.id, amount: 40_000 }] });
    await expense(w, { amount: 20_000, lines: [{ categoryId: w.expense, projectId: w.project, amount: 20_000 }], stockPayments: [{ docId: r2.id, amount: 20_000 }] });
    expect(await getDoc(w, r1.id)).toMatchObject({ paid: 60_000 });
    expect(await getDoc(w, r2.id)).toMatchObject({ paid: 60_000 });
    const u = await unpaid(w);
    expect(u.docs).toEqual([{ docId: r2.id, number: 'П-0002', at: D2, total: 90_000, paid: 60_000, own: 0, debt: 30_000 }]); // r1 оплачен полностью
  });

  it('переплата допустима: долг отрицательный, документ из списка долгов уходит', async () => {
    const w = await world();
    const r = await w.receipt(D1, [[w.cola, 1000, 50_000]]);
    const res = await expense(w, { stockPayments: [{ docId: r.id, amount: 100_000 }] });
    expect(res.statusCode).toBe(201);
    const doc = await getDoc(w, r.id);
    expect(doc.total - doc.paid).toBe(-50_000);
    expect((await unpaid(w)).docs).toEqual([]);
  });

  it('сумма оплат больше суммы расхода — 422 «Оплаты закупок больше суммы расхода», ничего не записано', async () => {
    const w = await world();
    const r1 = await w.receipt(D1, [[w.cola, 1000, 80_000]]);
    const r2 = await w.receipt(D2, [[w.chips, 1000, 80_000]]);
    const res = await expense(w, { amount: 100_000, stockPayments: [{ docId: r1.id, amount: 80_000 }, { docId: r2.id, amount: 30_000 }] });
    expect(res.statusCode).toBe(422);
    expect(res.json().error).toMatchObject({ code: 'STOCK_PAYMENTS_EXCEED', message: 'Оплаты закупок больше суммы расхода', fields: { stockPayments: 'Оплаты закупок больше суммы расхода' } });
    expect(w.h.t.sqlite.prepare('SELECT COUNT(*) n FROM operations').get()).toEqual({ n: 0 });
    expect(w.h.t.sqlite.prepare('SELECT COUNT(*) n FROM stock_doc_payments').get()).toEqual({ n: 0 });
  });

  it('проверки: только расход, поставщик обязателен и тот же, документ — неудалённое поступление, без повторов, счёт в валюте компании, сумма больше нуля', async () => {
    const w = await world();
    const r = await w.receipt(D1, [[w.cola, 1000, 50_000]]);
    const sale = await w.sale(D2, [[w.cola, 1000, 50_000]]);
    const otherSupplier = (await w.post(`/api/v1/companies/${w.cid}/counterparties`, { type: 'supplier', name: 'Поставщик Б' })).counterparty.id as number;
    const other = await w.doc({ type: 'receipt', at: D1, warehouseId: w.wh, counterpartyId: otherSupplier, lines: [{ itemId: w.chips, qty: 1000, amount: 10_000 }] });
    const code = async (over: Record<string, unknown>) => {
      const res = await expense(w, over);
      return [res.statusCode, res.json().error.code, res.json().error.message];
    };
    const pay = [{ docId: r.id, amount: 10_000 }];
    expect(await code({ type: 'income', lines: [{ categoryId: w.income, projectId: w.project, amount: 100_000 }], stockPayments: pay })).toEqual([422, 'VALIDATION', 'Оплата закупки — только у расхода']);
    expect(await code({ counterpartyId: null, stockPayments: pay })).toEqual([422, 'VALIDATION', 'Для оплаты закупки выберите поставщика']);
    expect(await code({ stockPayments: [{ docId: other.id, amount: 10_000 }] })).toEqual([422, 'VALIDATION', 'Поступление П-0002 — от другого поставщика']);
    expect(await code({ stockPayments: [{ docId: sale.id, amount: 10_000 }] })).toEqual([422, 'INVARIANT_5', 'Поступление не найдено или удалено']);
    expect(await code({ stockPayments: [{ docId: 99_999, amount: 10_000 }] })).toEqual([422, 'INVARIANT_5', 'Поступление не найдено или удалено']);
    expect(await code({ stockPayments: [{ docId: r.id, amount: 1000 }, { docId: r.id, amount: 2000 }] })).toEqual([422, 'VALIDATION', 'Документ указан в оплатах дважды']);
    expect(await code({ accountId: w.usd, amount: 10_000, lines: [{ categoryId: w.expense, projectId: w.project, amount: 10_000 }], stockPayments: pay })).toEqual([
      422,
      'VALIDATION',
      'Оплата закупки — только со счёта в валюте компании (KZT)',
    ]);
    expect((await expense(w, { stockPayments: [{ docId: r.id, amount: 0 }] })).statusCode).toBe(400);
    await w.h.req('DELETE', `${w.stock}/docs/${r.id}`);
    expect(await code({ stockPayments: pay })).toEqual([422, 'INVARIANT_5', 'Поступление не найдено или удалено']);
  });

  it('поступление другой компании оплатить нельзя', async () => {
    const w = await world();
    const otherCid = (await w.h.req('POST', '/api/v1/companies', { name: 'ТОО Другое' })).json().company.id as number;
    const proj = (await w.post(`/api/v1/companies/${otherCid}/projects`, { name: 'Чужой', templateKey: 'general' })).project.id as number;
    const wh = (await w.post(`/api/v1/companies/${otherCid}/stock/warehouses`, { projectId: proj, name: 'Чужой' })).warehouse.id as number;
    const item = (await w.post(`/api/v1/companies/${otherCid}/stock/items`, { name: 'Кола 0,5', unit: 'pcs' })).item.id as number;
    const foreign = (await w.post(`/api/v1/companies/${otherCid}/stock/docs`, { type: 'receipt', at: D1, warehouseId: wh, lines: [{ itemId: item, qty: 1000, amount: 1 }] })).doc;
    const res = await expense(w, { stockPayments: [{ docId: foreign.id, amount: 1 }] });
    expect([res.statusCode, res.json().error.code]).toEqual([422, 'INVARIANT_5']);
  });
});

describe('каскад: оплаты следуют за расходом и документом', () => {
  it('удаление расхода снимает оплату, восстановление возвращает; массовое удаление — так же', async () => {
    const w = await world();
    const r = await w.receipt(D1, [[w.cola, 1000, 100_000]]);
    const op = (await expense(w, { stockPayments: [{ docId: r.id, amount: 100_000 }] })).json().operation;
    expect((await getDoc(w, r.id)).paid).toBe(100_000);
    expect((await unpaid(w)).docs).toEqual([]);

    await w.h.req('DELETE', `${w.ops}/${op.id}`);
    expect(await getDoc(w, r.id)).toMatchObject({ paid: 0, payments: [] });
    expect((await unpaid(w)).docs).toMatchObject([{ docId: r.id, paid: 0, debt: 100_000 }]);
    expect((await w.h.req('GET', `${w.stock}/docs`)).json().docs[0].paid).toBe(0);

    await w.h.req('POST', `${w.ops}/${op.id}/restore`);
    expect((await getDoc(w, r.id)).paid).toBe(100_000);
    expect((await w.h.req('GET', `${w.ops}/${op.id}`)).json().operation.stockPayments).toHaveLength(1);

    await w.h.req('POST', `${w.ops}/bulk`, { action: 'delete', ids: [op.id] });
    expect((await getDoc(w, r.id)).paid).toBe(0);
    await w.h.req('POST', `${w.ops}/bulk`, { action: 'restore', ids: [op.id] });
    expect((await getDoc(w, r.id)).paid).toBe(100_000);
  });

  it('удаление поступления: расход остаётся обычным расходом, оплата на нём не показывается, ошибок нет', async () => {
    const w = await world();
    const r = await w.receipt(D1, [[w.cola, 1000, 100_000]]);
    const op = (await expense(w, { stockPayments: [{ docId: r.id, amount: 100_000 }] })).json().operation;
    expect((await w.h.req('DELETE', `${w.stock}/docs/${r.id}`)).statusCode).toBe(200);
    const got = (await w.h.req('GET', `${w.ops}/${op.id}`)).json().operation;
    expect([got.deletedAt, got.stockPayments]).toEqual([null, []]);
    // правка такого расхода не спотыкается об удалённый документ
    const edit = await w.h.req('PATCH', `${w.ops}/${op.id}`, { version: 1, comment: 'ок' });
    expect(edit.statusCode).toBe(200);
    expect((await unpaid(w)).docs).toEqual([]);
  });
});

describe('правка расхода с оплатами и 409', () => {
  it('список оплат заменяется целиком; без поля оплаты остаются; те же значения — без записи', async () => {
    const w = await world();
    const r1 = await w.receipt(D1, [[w.cola, 1000, 60_000]]);
    const r2 = await w.receipt(D2, [[w.chips, 1000, 60_000]]);
    const op = (await expense(w, { stockPayments: [{ docId: r1.id, amount: 60_000 }] })).json().operation;
    const same = await w.h.req('PATCH', `${w.ops}/${op.id}`, { version: 1, stockPayments: [{ docId: r1.id, amount: 60_000 }] });
    expect(same.json().operation.version).toBe(1);
    const keep = await w.h.req('PATCH', `${w.ops}/${op.id}`, { version: 1, comment: 'без поля оплат' });
    expect(keep.json().operation).toMatchObject({ version: 2, stockPayments: [{ docId: r1.id, amount: 60_000 }] });
    const moved = await w.h.req('PATCH', `${w.ops}/${op.id}`, { version: 2, stockPayments: [{ docId: r2.id, amount: 40_000 }] });
    expect(moved.json().operation).toMatchObject({ version: 3, stockPayments: [{ docId: r2.id, amount: 40_000 }] });
    expect([(await getDoc(w, r1.id)).paid, (await getDoc(w, r2.id)).paid]).toEqual([0, 40_000]);
    const cleared = await w.h.req('PATCH', `${w.ops}/${op.id}`, { version: 3, stockPayments: [] });
    expect(cleared.json().operation.stockPayments).toEqual([]);
    expect((await getDoc(w, r2.id)).paid).toBe(0);
    const diff = w.h.t.sqlite.prepare("SELECT diff FROM audit_log WHERE entity = 'operation' AND action = 'update' ORDER BY id DESC LIMIT 1").get() as { diff: string };
    expect(JSON.parse(diff.diff).before.stockPayments).toEqual([{ docId: r2.id, amount: 40_000 }]);
  });

  it('две вкладки: только оплата меняется, вторая со старой версией — 409, оплаты первой целы', async () => {
    const w = await world();
    const r = await w.receipt(D1, [[w.cola, 1000, 100_000]]);
    const op = (await expense(w, {})).json().operation;
    const first = await w.h.req('PATCH', `${w.ops}/${op.id}`, { version: 1, stockPayments: [{ docId: r.id, amount: 70_000 }] });
    expect(first.statusCode).toBe(200);
    const second = await w.h.req('PATCH', `${w.ops}/${op.id}`, { version: 1, stockPayments: [{ docId: r.id, amount: 30_000 }] });
    expect([second.statusCode, second.json().error.code]).toEqual([409, 'VERSION_CONFLICT']);
    expect((await getDoc(w, r.id)).paid).toBe(70_000);
  });

  it('уменьшение суммы расхода ниже оплат, смена поставщика и перевод в перевод запрещены, пока оплаты есть', async () => {
    const w = await world();
    const r = await w.receipt(D1, [[w.cola, 1000, 100_000]]);
    const op = (await expense(w, { stockPayments: [{ docId: r.id, amount: 100_000 }] })).json().operation;
    const lower = await w.h.req('PATCH', `${w.ops}/${op.id}`, { version: 1, amount: 50_000 });
    expect([lower.statusCode, lower.json().error.code]).toEqual([422, 'STOCK_PAYMENTS_EXCEED']);
    const otherSupplier = (await w.post(`/api/v1/companies/${w.cid}/counterparties`, { type: 'supplier', name: 'Поставщик Б' })).counterparty.id as number;
    const changed = await w.h.req('PATCH', `${w.ops}/${op.id}`, { version: 1, counterpartyId: otherSupplier });
    expect([changed.statusCode, changed.json().error.message]).toEqual([422, 'Поступление П-0001 — от другого поставщика']);
    const bulk = await w.h.req('POST', `${w.ops}/bulk`, { action: 'setCounterparty', ids: [op.id], counterpartyId: otherSupplier });
    expect(bulk.json()).toEqual({ changed: [], skipped: [{ id: op.id, reason: 'Поступление П-0001 — от другого поставщика' }] });
    const toTransfer = await w.h.req('PATCH', `${w.ops}/${op.id}`, { version: 1, type: 'transfer', toAccountId: w.usd, toAmount: 1, counterpartyId: null, lines: [{ projectId: w.project, categoryId: null, amount: 100_000 }] });
    expect(toTransfer.statusCode).toBe(422);
    // снять оплату и тогда менять
    expect((await w.h.req('PATCH', `${w.ops}/${op.id}`, { version: 1, stockPayments: [], counterpartyId: otherSupplier })).statusCode).toBe(200);
  });

  it('«своя» оплата в списке долгов при правке: own и долг без этого расхода', async () => {
    const w = await world();
    const r = await w.receipt(D1, [[w.cola, 1000, 100_000]]);
    const op = (await expense(w, { amount: 60_000, lines: [{ categoryId: w.expense, projectId: w.project, amount: 60_000 }], stockPayments: [{ docId: r.id, amount: 60_000 }] })).json().operation;
    expect((await unpaid(w)).docs).toMatchObject([{ docId: r.id, paid: 60_000, own: 0, debt: 40_000 }]);
    expect((await unpaid(w, `?operationId=${op.id}`)).docs).toMatchObject([{ docId: r.id, paid: 60_000, own: 60_000, debt: 40_000 }]);
    // документ, полностью оплаченный этим расходом, остаётся в списке при его правке
    const full = await expense(w, { amount: 40_000, lines: [{ categoryId: w.expense, projectId: w.project, amount: 40_000 }], stockPayments: [{ docId: r.id, amount: 40_000 }] });
    expect((await unpaid(w)).docs).toEqual([]);
    expect((await unpaid(w, `?operationId=${full.json().operation.id}`)).docs).toMatchObject([{ docId: r.id, own: 40_000, debt: 0 }]);
  });
});

describe('подсказка категории и архивная компания', () => {
  it('lastCategoryId — категория последнего расхода с оплатой этому поставщику', async () => {
    const w = await world();
    const r = await w.receipt(D1, [[w.cola, 1000, 100_000]]);
    expect((await unpaid(w)).lastCategoryId).toBeNull();
    const cat2 = (await w.post(`/api/v1/companies/${w.cid}/categories`, { kind: 'expense', name: 'Закупки' })).category.id as number;
    await expense(w, { amount: 10_000, lines: [{ categoryId: w.expense, projectId: w.project, amount: 10_000 }], stockPayments: [{ docId: r.id, amount: 10_000 }] });
    await expense(w, { paidAt: '2026-10-05T12:00:00.000Z', amount: 20_000, lines: [{ categoryId: cat2, projectId: w.project, amount: 20_000 }], stockPayments: [{ docId: r.id, amount: 20_000 }] });
    await expense(w, { paidAt: '2026-10-05T13:00:00.000Z', amount: 5000, lines: [{ categoryId: w.expense, projectId: w.project, amount: 5000 }] }); // без оплаты закупки — не считается
    expect((await unpaid(w)).lastCategoryId).toBe(cat2);
  });

  it('в архивной компании список долгов читается, расход с оплатой создать нельзя', async () => {
    const w = await world();
    const r = await w.receipt(D1, [[w.cola, 1000, 100_000]]);
    w.h.t.sqlite.prepare("UPDATE companies SET archived_at = '2026-10-06T00:00:00.000Z' WHERE id = ?").run(w.cid);
    expect((await unpaid(w)).docs).toHaveLength(1);
    const res = await expense(w, { stockPayments: [{ docId: r.id, amount: 100_000 }] });
    expect([res.statusCode, res.json().error.code]).toEqual([422, 'ARCHIVED_REFERENCE']);
  });
});

describe('R1/R3: отмена импорта и смена поставщика через API', () => {
  it('отмена импорта с «изменёнными»: расход с оплатами удаляется, оплаты исчезают, долг документа восстановлен', async () => {
    const w = await world();
    const mappings: AccountMapping[] = [{ key: 'касса', kind: 'existing', accountId: w.kzt, targetBalance: 2_000_000 }];
    const r = await importRows(
      w,
      [fr({ paidAt: xl('2026-10-03', '22:07:30'), amount: 8500, from: 'Касса', category: 'Зарплата', counterparty: 'Поставщик Б' })],
      { accounts: mappings },
    );
    const row = w.h.t.sqlite.prepare('SELECT id, counterparty_id cp FROM operations WHERE import_id = ?').get(r.import.id) as { id: number; cp: number };
    const doc = await w.doc({ type: 'receipt', at: D1, warehouseId: w.wh, counterpartyId: row.cp, lines: [{ itemId: w.cola, qty: 1000, amount: 850_000 }] });
    const edit = await w.h.req('PATCH', `${w.ops}/${row.id}`, { version: 1, stockPayments: [{ docId: doc.id, amount: 850_000 }] });
    expect(edit.statusCode, edit.body).toBe(200);
    expect((await getDoc(w, doc.id)).paid).toBe(850_000);

    const res = await w.h.req('POST', `/api/v1/companies/${w.cid}/imports/${r.import.id}/undo`, { includeEdited: true, edited: 1 });
    expect(res.statusCode, res.body).toBe(200);
    expect(w.h.t.sqlite.prepare('SELECT COUNT(*) n FROM stock_doc_payments').get()).toEqual({ n: 0 });
    expect(w.h.t.sqlite.prepare('SELECT COUNT(*) n FROM operations WHERE id = ?').get(row.id)).toEqual({ n: 0 });
    expect(await getDoc(w, doc.id)).toMatchObject({ total: 850_000, paid: 0, payments: [] });
  });

  it('смена поставщика у поступления с оплатой, созданной расходом через API, — 422 STOCK_DOC_HAS_PAYMENTS', async () => {
    const w = await world();
    const other = (await w.post(`/api/v1/companies/${w.cid}/counterparties`, { type: 'supplier', name: 'Поставщик Б' })).counterparty.id as number;
    const r = await w.receipt(D1, [[w.cola, 1000, 100_000]]);
    expect((await expense(w, { stockPayments: [{ docId: r.id, amount: 100_000 }] })).statusCode).toBe(201);
    const res = await w.h.req('PATCH', `${w.stock}/docs/${r.id}`, { version: 1, counterpartyId: other });
    expect([res.statusCode, res.json().error.code, res.json().error.message]).toEqual([422, 'STOCK_DOC_HAS_PAYMENTS', 'У поступления есть оплаты — сначала снимите их в расходах']);
  });
});
