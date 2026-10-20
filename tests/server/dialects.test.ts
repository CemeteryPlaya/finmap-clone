import { afterEach, describe, expect, it } from 'vitest';
import { opsWorld, type OpsWorld } from '../helpers/ops';
import { stockWorld } from '../helpers/stock';

/**
 * Поведение, которое у SQLite и Postgres может разойтись (план 2026-10-20-vercel-postgres, Review Focus 1 и 3): тест идёт
 * в обоих проектах vitest — server-sqlite и server-pg.
 */

let w: OpsWorld;
afterEach(async () => w?.h.t.cleanup());

/** 300 млн ₸ в тиынах — больше 2^31: int4 переполнился бы, int8 без разбора пришёл бы строкой. */
const BIG = 30_000_000_000;

describe('суммы больше 2^31 (Review Focus 1)', () => {
  it('балансы, остаток после операции и «Прибыль» — точные числа', async () => {
    w = await opsWorld();
    const ops = [
      { type: 'income', paidAt: '2026-10-02T10:00:00Z', accountId: w.kzt, amount: BIG, categoryId: w.income },
      { type: 'income', paidAt: '2026-10-03T10:00:00Z', accountId: w.kzt, amount: BIG + 7, categoryId: w.income },
    ];
    for (const body of ops) await w.post(w.ops, body);

    const balances = (await w.h.req('GET', `/api/v1/companies/${w.cid}/balances`)).json();
    expect(balances.accounts.find((a: { accountId: number }) => a.accountId === w.kzt).balance).toBe(2 * BIG + 7);
    expect(balances.total).toMatchObject({ currency: 'KZT', amount: 2 * BIG + 7 });

    const journal = (await w.h.req('GET', w.ops)).json().items as { balanceAfter: number }[];
    expect(journal.map((i) => i.balanceAfter)).toEqual([2 * BIG + 7, BIG]);

    const pnl = (await w.h.req('GET', `/api/v1/companies/${w.cid}/analytics/pnl?from=2026-10-01&to=2026-10-31&step=month`)).json();
    const income = (pnl.rows as { id: string; total: number }[]).find((r) => r.id === 'income')!;
    expect(income.total).toBe(2 * BIG + 7);
    expect(typeof income.total).toBe('number');
  });
});

describe('два списания из одной партии одновременно (Review Focus 3)', () => {
  it('одно проходит, второе — 422 INSUFFICIENT_STOCK, остаток не уходит в минус', async () => {
    const s = await stockWorld();
    w = s;
    await s.receipt('2026-10-02T10:00:00.000Z', [[s.cola, 4000, 40_000]]);
    const writeoff = () =>
      s.h.req('POST', `${s.stock}/docs`, { type: 'writeoff', at: '2026-10-03T10:00:00.000Z', warehouseId: s.wh, reason: 'defect', lines: [{ itemId: s.cola, qty: 3000 }] });
    const results = await Promise.all([writeoff(), writeoff()]);
    expect(results.map((r) => r.statusCode).sort()).toEqual([201, 422]);
    expect(results.find((r) => r.statusCode === 422)!.json().error.code).toBe('INSUFFICIENT_STOCK');
    const left = (await s.h.t.q('SELECT COALESCE(SUM(qty_left), 0) AS qtyLeft FROM stock_batches WHERE item_id = ?', s.cola))[0] as { qtyLeft: number };
    expect(left.qtyLeft).toBe(1000);
  });
});
