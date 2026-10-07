import { afterEach, describe, expect, it } from 'vitest';
import { createLedgerBalances } from '../../src/server/modules/balances/service';
import { opsWorld, type OpsWorld } from '../helpers/ops';

let w: OpsWorld;
afterEach(async () => w?.h.t.cleanup());

interface Item {
  id: number;
  balanceAfter: number | null;
  toBalanceAfter: number | null;
}

const items = async (qs = '') => {
  const res = await w.h.req('GET', qs ? `${w.ops}?${qs}` : w.ops);
  expect(res.statusCode, res.body).toBe(200);
  return (res.json().items as Item[]).map(({ id, balanceAfter, toBalanceAfter }) => ({ id, balanceAfter, toBalanceAfter }));
};
const op = async (body: Record<string, unknown>) =>
  (await w.post(w.ops, { type: 'expense', accountId: w.kzt, amount: 1000, ...body })).operation.id as number;

describe('журнал: остаток после операции (§4.7)', () => {
  it('по полной истории счёта в порядке (paidAt, id), без учёта фильтра; у перевода — оба счёта; удалённые не учитываются', async () => {
    w = await opsWorld();
    // стартовый остаток счёта KZT — 1000 ₸
    expect((await w.h.req('PATCH', `/api/v1/companies/${w.cid}/accounts/${w.kzt}`, { startingBalance: 100000 })).statusCode).toBe(200);
    const a = await op({ type: 'income', paidAt: '2026-10-02T10:00:00Z', amount: 50000 });
    const b = await op({ paidAt: '2026-10-03T10:00:00Z', amount: 20000 });
    const d = await op({ type: 'income', paidAt: '2026-10-03T10:00:00Z', amount: 10000 }); // та же дата, id больше — после b
    const c = await op({ type: 'transfer', paidAt: '2026-10-04T10:00:00Z', amount: 47512, toAccountId: w.usd, toAmount: 100 });
    const e = await op({ paidAt: '2026-10-01T10:00:00Z', amount: 5000 }); // внесена последней, но по дате — первая
    const f = await op({ type: 'income', paidAt: '2026-10-02T09:00:00Z', amount: 7000 });
    await w.h.req('DELETE', `${w.ops}/${f}`); // удалённая не влияет на остатки

    // 1000 \u2212 50 = 950; +500 = 1450; \u2212200 = 1250; +100 = 1350; \u2212475,12 = 874,88 ₸; USD: 0 + 1,00 $
    expect(await items()).toEqual([
      { id: c, balanceAfter: 87488, toBalanceAfter: 100 },
      { id: d, balanceAfter: 135000, toBalanceAfter: null },
      { id: b, balanceAfter: 125000, toBalanceAfter: null },
      { id: a, balanceAfter: 145000, toBalanceAfter: null },
      { id: e, balanceAfter: 95000, toBalanceAfter: null },
    ]);
    // фильтр не меняет остатки: они считаются по всей истории счёта
    expect(await items('types=expense')).toEqual([
      { id: b, balanceAfter: 125000, toBalanceAfter: null },
      { id: e, balanceAfter: 95000, toBalanceAfter: null },
    ]);
    expect(await items(`accountIds=${w.usd}`)).toEqual([{ id: c, balanceAfter: 87488, toBalanceAfter: 100 }]);
    // страница с курсором — те же значения
    const second = (await w.h.req('GET', `${w.ops}?limit=2`)).json().nextCursor as string;
    expect((await items(`limit=2&cursor=${second}`)).map((x) => x.balanceAfter)).toEqual([125000, 145000]);

    // остаток после последней операции = баланс счёта
    const ledger = createLedgerBalances(w.h.t.db).companyBalances(w.cid);
    expect(ledger.find((x) => x.accountId === w.kzt)!.balance).toBe(87488);
    expect(ledger.find((x) => x.accountId === w.usd)!.balance).toBe(100);
  });

  it('восстановление удалённой операции снова включает её в историю', async () => {
    w = await opsWorld();
    const a = await op({ type: 'income', paidAt: '2026-10-02T10:00:00Z', amount: 3000 });
    const b = await op({ paidAt: '2026-10-03T10:00:00Z', amount: 1000 });
    await w.h.req('DELETE', `${w.ops}/${a}`);
    expect(await items()).toEqual([{ id: b, balanceAfter: -1000, toBalanceAfter: null }]);
    await w.h.req('POST', `${w.ops}/${a}/restore`);
    expect(await items()).toEqual([
      { id: b, balanceAfter: 2000, toBalanceAfter: null },
      { id: a, balanceAfter: 3000, toBalanceAfter: null },
    ]);
  });
});
