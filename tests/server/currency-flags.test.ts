import { afterEach, describe, expect, it } from 'vitest';
import { opsWorld, type OpsWorld } from '../helpers/ops';

let w: OpsWorld;
afterEach(async () => w?.h.t.cleanup());

describe('флаги блокировки валют в списках', () => {
  it('счёт с операцией (даже удалённой) — hasOperations; компания с операциями или фиксированным курсом — currencyLocked', async () => {
    w = await opsWorld();
    const op = await w.post(w.ops, { type: 'income', paidAt: '2026-10-05T10:00:00Z', accountId: w.kzt, amount: 100 });
    await w.h.req('DELETE', `${w.ops}/${op.operation.id}`);

    const accounts = (await w.h.req('GET', `/api/v1/companies/${w.cid}/accounts`)).json().accounts as { id: number; hasOperations: boolean }[];
    expect(accounts.find((a) => a.id === w.kzt)!.hasOperations).toBe(true);
    expect(accounts.find((a) => a.id === w.usd)!.hasOperations).toBe(false);

    const empty = await w.h.company('Пустая');
    const withFixed = await w.h.company('С курсом');
    await w.post(`/api/v1/companies/${withFixed}/fixed-rates`, { currency: 'USD', rate: '500', validFrom: '2026-10-01' });
    const list = (await w.h.req('GET', '/api/v1/companies')).json().companies as { id: number; currencyLocked: boolean }[];
    const locked = Object.fromEntries(list.map((c) => [c.id, c.currencyLocked]));
    expect(locked).toEqual({ [w.cid]: true, [empty]: false, [withFixed]: true });
  });
});
