import { afterEach, describe, expect, it } from 'vitest';
import { opsWorld, type OpsWorld } from '../helpers/ops';

let w: OpsWorld;
afterEach(async () => w?.h.t.cleanup());

describe('RATE_UNAVAILABLE: какой курс нужен — в details (§4.3 п. 6, «Указать курс на {D}»)', () => {
  it('нет курса валюты счёта: details с валютой и датой; после ручного курса на эту дату операция создаётся', async () => {
    w = await opsWorld('2026-10-20T12:00:00.000Z');
    const body = { type: 'expense', paidAt: '2026-10-09T10:00:00Z', accountId: w.usd, amount: 100 };
    const res = await w.h.req('POST', w.ops, body);
    expect(res.statusCode).toBe(422);
    expect(res.json().error).toEqual({ code: 'RATE_UNAVAILABLE', message: 'Нет курса USD на 09.10.2026', details: { currency: 'USD', date: '2026-10-09' } });

    await w.post('/api/v1/rates/manual', { date: '2026-10-09', currency: 'USD', rate: '480' });
    expect((await w.h.req('POST', w.ops, body)).statusCode).toBe(201);
  });

  it('нет курса базовой валюты компании (база USD, счёт в тенге): в details — базовая валюта', async () => {
    w = await opsWorld('2026-10-20T12:00:00.000Z');
    const res = await w.h.req('POST', '/api/v1/companies', { name: 'ТОО Долларовая', baseCurrency: 'USD' });
    const cid = res.json().company.id as number;
    const cash = (await w.post(`/api/v1/companies/${cid}/accounts`, { name: 'Касса', currency: 'KZT', openedAt: '2026-10-01' })).account.id;
    const err = await w.h.req('POST', `/api/v1/companies/${cid}/operations`, { type: 'income', paidAt: '2026-10-15T10:00:00Z', accountId: cash, amount: 100 });
    expect(err.json().error.details).toEqual({ currency: 'USD', date: '2026-10-15' });
  });

  it('GET /rates без курса — те же details; у остальных ошибок details нет', async () => {
    w = await opsWorld('2026-10-20T12:00:00.000Z');
    const none = await w.h.req('GET', '/api/v1/rates?date=2026-10-15&currency=USD');
    expect(none.json().error.details).toEqual({ currency: 'USD', date: '2026-10-15' });
    const invalid = await w.h.req('POST', w.ops, { type: 'expense', paidAt: '2026-10-09T10:00:00Z', accountId: w.kzt, amount: 0 });
    expect(invalid.json().error).not.toHaveProperty('details');
  });
});
