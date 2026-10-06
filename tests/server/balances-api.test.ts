import { afterEach, describe, expect, it } from 'vitest';
import { opsWorld, type OpsWorld } from '../helpers/ops';

let w: OpsWorld;
afterEach(async () => w?.h.t.cleanup());

describe('balances API', () => {
  it('балансы счетов и «всего на счетах» по курсу на сегодня; валюта без курса — в unavailable (Review Focus 5)', async () => {
    w = await opsWorld(); // сегодня 2026-10-06, курс USD от 2026-10-01 ещё действует
    const accounts = `/api/v1/companies/${w.cid}/accounts`;
    await w.h.req('PATCH', `${accounts}/${w.kzt}`, { startingBalance: 100000 });
    await w.post(w.ops, { type: 'transfer', paidAt: '2026-10-02T10:00:00Z', accountId: w.kzt, toAccountId: w.usd, amount: 47512, toAmount: 100 });
    w.h.t.sqlite.prepare("INSERT INTO currencies (code,name,symbol,minor_units) VALUES ('EUR','Евро','€',2)").run();
    const eur = (await w.post(accounts, { name: 'Евро', currency: 'EUR', openedAt: '2026-10-01', startingBalance: 1000 })).account.id;

    const res = await w.h.req('GET', `/api/v1/companies/${w.cid}/balances`);
    expect(res.statusCode).toBe(200);
    expect(res.json().accounts).toEqual([
      { accountId: w.kzt, currency: 'KZT', balance: 52488 },
      { accountId: w.usd, currency: 'USD', balance: 100 },
      { accountId: eur, currency: 'EUR', balance: 1000 },
    ]);
    expect(res.json().total).toEqual({ currency: 'KZT', amount: 100000, unavailable: ['EUR'] });
  });

  it('сводка для переключателя: активные компании, итог в своей базовой валюте', async () => {
    w = await opsWorld();
    const usdCo = (await w.post('/api/v1/companies', { name: 'USD Ltd', baseCurrency: 'USD' })).company.id;
    await w.post(`/api/v1/companies/${usdCo}/accounts`, { name: 'Сейф', currency: 'USD', openedAt: '2026-10-01', startingBalance: 500 });
    const archived = await w.h.company('Архивная');
    await w.post(`/api/v1/companies/${archived}/archive`, {});

    const list = (await w.h.req('GET', '/api/v1/companies/summary')).json().companies as { id: number; name: string; total: object }[];
    expect(list.map((c) => c.id)).toEqual([w.cid, usdCo]);
    expect(list.find((c) => c.id === usdCo)!.total).toEqual({ currency: 'USD', amount: 500, unavailable: [] });
    expect(list.find((c) => c.id === w.cid)!.total).toEqual({ currency: 'KZT', amount: 0, unavailable: [] });
  });

  it('неизвестная компания — 404', async () => {
    w = await opsWorld();
    const res = await w.h.req('GET', '/api/v1/companies/999/balances');
    expect(res.statusCode).toBe(404);
    expect(res.json().error.message).toBe('Компания не найдена'); // ответ маршрута, а не «маршрут не найден»
  });
});
