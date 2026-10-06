import { afterEach, describe, expect, it } from 'vitest';
import { createTestApp, loginAs, ORIGIN_HEADERS, seedUser, type TestApp } from '../helpers/test-app';

let t: TestApp;
afterEach(async () => t?.cleanup());

async function setup() {
  t = await createTestApp();
  t.sqlite.prepare("INSERT INTO currencies (code,name,symbol,minor_units) VALUES ('KZT','Тенге','₸',2),('USD','Доллар','$',2)").run();
  await seedUser(t);
  const cookie = await loginAs(t);
  const req = (method: 'GET' | 'POST' | 'PATCH', url: string, payload?: object) =>
    t.app.inject({ method, url, headers: { ...ORIGIN_HEADERS, cookie }, ...(payload !== undefined ? { payload } : {}) });
  return { req };
}

describe('companies API', () => {
  it('создаёт компанию с системными статьями и пишет историю', async () => {
    const { req } = await setup();
    const res = await req('POST', '/api/v1/companies', { name: '  ТОО Ромашка ' });
    expect(res.statusCode).toBe(201);
    const { company } = res.json();
    expect(company).toMatchObject({ name: 'ТОО Ромашка', baseCurrency: 'KZT', archivedAt: null });
    const n = t.sqlite.prepare('SELECT COUNT(*) n FROM categories WHERE company_id = ? AND system_key IS NOT NULL').get(company.id) as { n: number };
    expect(n.n).toBe(9);
    const audit = t.sqlite.prepare("SELECT action, company_id FROM audit_log WHERE entity = 'company'").all();
    expect(audit).toEqual([{ action: 'create', company_id: company.id }]);
    const list = await req('GET', '/api/v1/companies');
    expect(list.json().companies.map((c: { name: string }) => c.name)).toEqual(['ТОО Ромашка']);
  });

  it('валидирует название и валюту', async () => {
    const { req } = await setup();
    const res = await req('POST', '/api/v1/companies', { name: '', baseCurrency: 'XXX' });
    expect(res.statusCode).toBe(400);
    expect(Object.keys(res.json().error.fields).sort()).toEqual(['baseCurrency', 'name']);
  });

  it('переименовывает и меняет базовую валюту', async () => {
    const { req } = await setup();
    const { company } = (await req('POST', '/api/v1/companies', { name: 'A' })).json();
    const res = await req('PATCH', `/api/v1/companies/${company.id}`, { name: 'Б', baseCurrency: 'USD' });
    expect(res.json().company).toMatchObject({ name: 'Б', baseCurrency: 'USD' });
    expect((await req('PATCH', '/api/v1/companies/999', { name: 'X' })).statusCode).toBe(404);
    expect((await req('PATCH', '/api/v1/companies/abc', { name: 'X' })).statusCode).toBe(404);
    // Number() превратил бы эти строки в существующий id — строгий parseId обязан дать 404
    expect((await req('PATCH', `/api/v1/companies/${company.id}e0`, { name: 'X' })).statusCode).toBe(404);
    expect((await req('PATCH', `/api/v1/companies/${company.id}.0`, { name: 'X' })).statusCode).toBe(404);
    const empty = await req('PATCH', `/api/v1/companies/${company.id}`, {});
    expect(empty.statusCode).toBe(200);
    expect(empty.json().company).toMatchObject({ name: 'Б', baseCurrency: 'USD' });
  });

  it('архив: только без активных счетов; архивная компания только для чтения', async () => {
    const { req } = await setup();
    const { company } = (await req('POST', '/api/v1/companies', { name: 'A' })).json();
    t.sqlite
      .prepare("INSERT INTO accounts (company_id, name, currency, starting_balance, opened_at, order_index, created_at) VALUES (?,'К','KZT',0,'2026-10-06',0,'x')")
      .run(company.id);
    const blocked = await req('POST', `/api/v1/companies/${company.id}/archive`);
    expect(blocked.statusCode).toBe(422);
    expect(blocked.json().error.code).toBe('ARCHIVED_REFERENCE');

    t.sqlite.prepare("UPDATE accounts SET archived_at = 'x' WHERE company_id = ?").run(company.id);
    const ok = await req('POST', `/api/v1/companies/${company.id}/archive`);
    expect(ok.statusCode).toBe(200);
    expect(ok.json().company.archivedAt).not.toBeNull();

    const rename = await req('PATCH', `/api/v1/companies/${company.id}`, { name: 'B' });
    expect(rename.statusCode).toBe(422);
    expect(rename.json().error.code).toBe('ARCHIVED_REFERENCE');

    const back = await req('POST', `/api/v1/companies/${company.id}/unarchive`);
    expect(back.json().company.archivedAt).toBeNull();
    const actions = t.sqlite.prepare("SELECT action FROM audit_log WHERE entity = 'company' ORDER BY id").all() as { action: string }[];
    expect(actions.map((a) => a.action)).toEqual(['create', 'archive', 'unarchive']);
  });

  it('без входа — 401', async () => {
    t = await createTestApp();
    expect((await t.app.inject({ method: 'GET', url: '/api/v1/companies' })).statusCode).toBe(401);
  });
});
