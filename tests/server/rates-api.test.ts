import { afterEach, describe, expect, it } from 'vitest';
import { createApi, type ApiHarness } from '../helpers/api';

let h: ApiHarness;
afterEach(async () => h?.t.cleanup());

describe('rates API', () => {
  it('справочник валют и курс к тенге на дату с запасным предыдущим днём', async () => {
    h = await createApi('2026-10-20T00:00:00.000Z');
    const codes = (await h.req('GET', '/api/v1/currencies')).json().currencies.map((c: { code: string }) => c.code);
    expect(codes).toEqual(expect.arrayContaining(['KZT', 'USD']));
    await h.req('POST', '/api/v1/rates/manual', { date: '2026-10-01', currency: 'USD', rate: '475.12' });
    const res = await h.req('GET', '/api/v1/rates?date=2026-10-03&currency=USD');
    expect(res.json().rate).toEqual({ currency: 'USD', date: '2026-10-03', rateToKzt: '475.12', effectiveDate: '2026-10-01', source: 'manual' });
    const none = await h.req('GET', '/api/v1/rates?date=2026-10-15&currency=USD');
    expect(none.statusCode).toBe(422);
    expect(none.json().error).toMatchObject({ code: 'RATE_UNAVAILABLE', message: 'Нет курса USD на 15.10.2026' });
    expect((await h.req('GET', '/api/v1/rates?date=2026-02-31&currency=USD')).statusCode).toBe(400);
    expect((await h.req('GET', '/api/v1/rates?date=2026-10-15&currency=KZT')).json().rate).toMatchObject({ rateToKzt: '1', source: 'base' });
  });

  it('ручные курсы: создание, дубль даты, тенге, правка, удаление, история без компании', async () => {
    h = await createApi();
    const created = await h.req('POST', '/api/v1/rates/manual', { date: '2026-10-01', currency: 'USD', rate: '475,12' });
    expect(created.statusCode).toBe(201);
    expect(created.json().rate).toMatchObject({ date: '2026-10-01', currency: 'USD', rateToKzt: '475.12', source: 'manual' });
    const id = created.json().rate.id as number;
    const dup = await h.req('POST', '/api/v1/rates/manual', { date: '2026-10-01', currency: 'USD', rate: '480' });
    expect(dup.json().error.fields.date).toBe('Курс на эту дату уже есть');
    const kzt = await h.req('POST', '/api/v1/rates/manual', { date: '2026-10-01', currency: 'KZT', rate: '1' });
    expect(kzt.json().error.fields.currency).toBe('Курс тенге к тенге всегда 1');
    for (const rate of ['0', '-1', 'abc', '1.12345678901']) {
      expect((await h.req('POST', '/api/v1/rates/manual', { date: '2026-10-02', currency: 'USD', rate })).statusCode).toBe(400);
    }
    expect((await h.req('PATCH', `/api/v1/rates/manual/${id}`, { rate: '480' })).json().rate.rateToKzt).toBe('480');
    await h.req('PATCH', `/api/v1/rates/manual/${id}`, { rate: '480.000' }); // то же значение — без истории
    expect((await h.req('GET', '/api/v1/rates/manual')).json().rates).toHaveLength(1);
    expect((await h.req('DELETE', `/api/v1/rates/manual/${id}`)).statusCode).toBe(204);
    expect((await h.req('DELETE', `/api/v1/rates/manual/${id}`)).statusCode).toBe(404);
    const audit = (await h.t.q("SELECT action, company_id FROM audit_log WHERE entity = 'rate' ORDER BY id"));
    expect(audit).toEqual([
      { action: 'create', company_id: null },
      { action: 'update', company_id: null },
      { action: 'delete', company_id: null },
    ]);
  });

  it('фиксированные курсы: периоды не пересекаются, базовую валюту нельзя, чужие id — 404', async () => {
    h = await createApi();
    const cid = await h.company();
    const other = await h.company();
    const base = `/api/v1/companies/${cid}/fixed-rates`;
    const a = await h.req('POST', base, { currency: 'USD', rate: '500', validFrom: '2026-10-01', validTo: '2026-10-31' });
    expect(a.statusCode).toBe(201);
    expect(a.json().fixedRate).toMatchObject({ currency: 'USD', rate: '500', validFrom: '2026-10-01', validTo: '2026-10-31' });
    const overlap = await h.req('POST', base, { currency: 'USD', rate: '510', validFrom: '2026-10-15', validTo: null });
    expect(overlap.json().error.fields.validFrom).toBe('Период пересекается с другим фиксированным курсом');
    expect((await h.req('POST', base, { currency: 'USD', rate: '510', validFrom: '2026-11-01' })).statusCode).toBe(201);
    const reversed = await h.req('POST', base, { currency: 'USD', rate: '1', validFrom: '2027-02-01', validTo: '2027-01-01' });
    expect(reversed.json().error.fields.validTo).toBe('Дата окончания раньше начала');
    expect((await h.req('POST', base, { currency: 'KZT', rate: '1', validFrom: '2026-10-01' })).json().error.fields.currency).toBe(
      'Это базовая валюта компании',
    );
    // правка: сдвиг конца первого периода в бессрочный пересечётся со вторым
    const id = a.json().fixedRate.id as number;
    expect((await h.req('PATCH', `${base}/${id}`, { validTo: null })).json().error.fields.validFrom).toBe(
      'Период пересекается с другим фиксированным курсом',
    );
    expect((await h.req('PATCH', `${base}/${id}`, { rate: '505' })).json().fixedRate.rate).toBe('505');
    expect((await h.req('GET', base)).json().fixedRates.map((r: { validFrom: string }) => r.validFrom)).toEqual(['2026-10-01', '2026-11-01']);
    expect((await h.req('PATCH', `/api/v1/companies/${other}/fixed-rates/${id}`, { rate: '1' })).statusCode).toBe(404);
    expect((await h.req('DELETE', `/api/v1/companies/${other}/fixed-rates/${id}`)).statusCode).toBe(404);
    expect((await h.req('DELETE', `${base}/${id}`)).statusCode).toBe(204);
    expect(await h.auditCount('fixed_rate')).toBe(4); // create ×2, update, delete
  });
});
