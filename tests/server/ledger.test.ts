import { afterEach, describe, expect, it } from 'vitest';
import { createLedgerBalances } from '../../src/server/modules/balances/service';
import { opsWorld, type OpsWorld } from '../helpers/ops';

let w: OpsWorld;
afterEach(async () => w?.h.t.cleanup());

const create = async (body: object) => {
  const res = await w.h.req('POST', w.ops, body);
  if (res.statusCode !== 201) throw new Error(res.body);
  return res.json().operation as { id: number };
};
const accountsUrl = () => `/api/v1/companies/${w.cid}/accounts`;

describe('ledger: балансы и ссылки операций', () => {
  it('баланс: старт + доходы - расходы, перевод между валютами, удалённые не считаются; совпадает с пересчётом в JS (Review Focus 5)', async () => {
    w = await opsWorld();
    await w.h.req('PATCH', `${accountsUrl()}/${w.kzt}`, { startingBalance: 100000 });
    await create({ type: 'income', paidAt: '2026-10-02T10:00:00Z', accountId: w.kzt, amount: 50000 });
    await create({
      type: 'expense',
      paidAt: '2026-10-03T10:00:00Z',
      accountId: w.kzt,
      amount: 20000,
      lines: [
        { projectId: w.project, amount: 15000 },
        { projectId: w.project2, amount: 5000 },
      ],
    });
    await create({ type: 'transfer', paidAt: '2026-10-04T10:00:00Z', accountId: w.kzt, toAccountId: w.usd, amount: 47512, toAmount: 100 });
    const gone = await create({ type: 'expense', paidAt: '2026-10-04T11:00:00Z', accountId: w.kzt, amount: 999 });
    await w.h.req('DELETE', `${w.ops}/${gone.id}`);

    const ledger = createLedgerBalances(w.h.t.db);
    const byId = new Map(ledger.companyBalances(w.cid).map((b) => [b.accountId, b]));
    expect(byId.get(w.kzt)).toMatchObject({ currency: 'KZT', balance: 82488, archived: false });
    expect(byId.get(w.usd)).toMatchObject({ currency: 'USD', balance: 100 });
    expect(ledger.accountBalance({ id: w.kzt, startingBalance: 100000 })).toBe(82488);

    // независимый пересчёт по всем операциям (критерий §12)
    const rows = w.h.t.sqlite
      .prepare("SELECT type, account_id a, amount, to_account_id t, to_amount ta FROM operations WHERE deleted_at IS NULL AND status = 'actual'")
      .all() as { type: string; a: number; amount: number; t: number | null; ta: number | null }[];
    const js = new Map<number, number>();
    for (const r of rows) {
      js.set(r.a, (js.get(r.a) ?? 0) + (r.type === 'income' ? r.amount : -r.amount));
      if (r.type === 'transfer') js.set(r.t!, (js.get(r.t!) ?? 0) + r.ta!);
    }
    expect(100000 + js.get(w.kzt)!).toBe(82488);
    expect(js.get(w.usd)).toBe(100);

    // архив только при нулевом балансе — теперь по настоящему балансу
    const arch = await w.h.req('POST', `${accountsUrl()}/${w.kzt}/archive`);
    expect(arch.statusCode).toBe(422);
    expect(arch.json().error.message).toBe('Счёт можно перевести в архив только при нулевом балансе');
  });

  it('баланс архивного счёта остаётся нулевым: правка допустимых полей его не меняет', async () => {
    w = await opsWorld();
    const safe = (await w.post(accountsUrl(), { name: 'Сейф', currency: 'KZT', openedAt: '2026-10-01' })).account.id;
    const inc = await create({ type: 'income', paidAt: '2026-10-02T10:00:00Z', accountId: safe, amount: 100 });
    await create({ type: 'expense', paidAt: '2026-10-03T10:00:00Z', accountId: safe, amount: 100 });
    await w.post(`${accountsUrl()}/${safe}/archive`, {});
    expect((await w.h.req('PATCH', `${w.ops}/${inc.id}`, { version: 1, comment: 'сверка', accrualDate: '2026-09-01' })).statusCode).toBe(200);
    expect((await w.h.req('PATCH', `${w.ops}/${inc.id}`, { version: 2, amount: 50 })).statusCode).toBe(422);
    expect((await w.h.req('DELETE', `${w.ops}/${inc.id}`)).statusCode).toBe(422);
    const ledger = createLedgerBalances(w.h.t.db);
    expect(ledger.companyBalances(w.cid).find((b) => b.accountId === safe)).toMatchObject({ balance: 0, archived: true });
  });

  it('инвариант 9: на что ссылается операция (даже удалённая), то удалить нельзя; неиспользуемое — можно', async () => {
    w = await opsWorld();
    const op = await create({
      type: 'expense',
      paidAt: '2026-10-05T10:00:00Z',
      accountId: w.kzt,
      amount: 100,
      counterpartyId: w.counterparty,
      tagIds: [w.tag],
      lines: [{ categoryId: w.expense, projectId: w.project, amount: 100 }],
    });
    await w.h.req('DELETE', `${w.ops}/${op.id}`);
    const b = `/api/v1/companies/${w.cid}`;
    for (const url of [`${b}/categories/${w.expense}`, `${b}/projects/${w.project}`, `${b}/counterparties/${w.counterparty}`, `${b}/tags/${w.tag}`, `${b}/accounts/${w.kzt}`]) {
      const res = await w.h.req('DELETE', url);
      expect(res.statusCode).toBe(422);
      expect(res.json().error.code).toBe('INVARIANT_9');
    }
    expect((await w.h.req('DELETE', `${b}/categories/${w.income}`)).statusCode).toBe(204);
    expect((await w.h.req('DELETE', `${b}/projects/${w.project2}`)).statusCode).toBe(204);
  });

  it('валюта счёта с операциями заблокирована; дату открытия нельзя сдвинуть позже первой операции', async () => {
    w = await opsWorld();
    await create({ type: 'income', paidAt: '2026-10-03T10:00:00Z', accountId: w.kzt, amount: 100 });
    const cur = await w.h.req('PATCH', `${accountsUrl()}/${w.kzt}`, { currency: 'USD' });
    expect(cur.statusCode).toBe(422);
    expect(cur.json().error.code).toBe('CURRENCY_LOCKED');
    const late = await w.h.req('PATCH', `${accountsUrl()}/${w.kzt}`, { openedAt: '2026-10-04' });
    expect(late.json().error.code).toBe('INVARIANT_6');
    expect(late.json().error.message).toBe('Есть операции от 03.10.2026 — дата открытия не может быть позже');
    expect((await w.h.req('PATCH', `${accountsUrl()}/${w.kzt}`, { openedAt: '2026-10-03' })).statusCode).toBe(200);
    expect((await w.h.req('PATCH', `${accountsUrl()}/${w.kzt}`, { openedAt: '2026-09-01' })).statusCode).toBe(200);
    // у счёта без операций валюту менять можно
    expect((await w.h.req('PATCH', `${accountsUrl()}/${w.usd}`, { currency: 'KZT' })).statusCode).toBe(200);
  });

  it('базовая валюта компании блокируется операциями (даже удалёнными) и фиксированными курсами', async () => {
    w = await opsWorld();
    const op = await create({ type: 'income', paidAt: '2026-10-05T10:00:00Z', accountId: w.kzt, amount: 100 });
    await w.h.req('DELETE', `${w.ops}/${op.id}`);
    const locked = await w.h.req('PATCH', `/api/v1/companies/${w.cid}`, { baseCurrency: 'USD' });
    expect(locked.statusCode).toBe(422);
    expect(locked.json().error).toMatchObject({
      code: 'CURRENCY_LOCKED',
      message: 'В компании есть операции или фиксированные курсы — базовую валюту изменить нельзя',
    });
    expect((await w.h.req('PATCH', `/api/v1/companies/${w.cid}`, { name: 'ТОО новое' })).statusCode).toBe(200);

    const withFixed = await w.h.company('С курсом');
    await w.post(`/api/v1/companies/${withFixed}/fixed-rates`, { currency: 'USD', rate: '500', validFrom: '2026-10-01' });
    expect((await w.h.req('PATCH', `/api/v1/companies/${withFixed}`, { baseCurrency: 'USD' })).json().error.code).toBe('CURRENCY_LOCKED');

    const empty = await w.h.company('Пустая');
    expect((await w.h.req('PATCH', `/api/v1/companies/${empty}`, { baseCurrency: 'USD' })).statusCode).toBe(200);
  });
});
