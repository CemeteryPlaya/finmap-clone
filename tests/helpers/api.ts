import type { LightMyRequestResponse } from 'fastify';
import { createTestApp, loginAs, ORIGIN_HEADERS, seedUser, type TestApp } from './test-app';

export type Req = (
  method: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE',
  url: string,
  payload?: unknown,
) => Promise<LightMyRequestResponse>;

export interface ApiHarness {
  t: TestApp;
  req: Req;
  /** Создаёт компанию через API и возвращает её id. */
  company(name?: string): Promise<number>;
  /** Сколько записей истории по сущности (и действию). */
  auditCount(entity: string, action?: string): number;
}

/** Приложение с валютами KZT и USD и вошедшим пользователем admin. */
export async function createApi(now?: string): Promise<ApiHarness> {
  const t = await createTestApp({}, undefined, now ? () => new Date(now) : undefined);
  t.sqlite.prepare("INSERT INTO currencies (code,name,symbol,minor_units) VALUES ('KZT','Тенге','₸',2),('USD','Доллар','$',2)").run();
  await seedUser(t);
  const cookie = await loginAs(t);
  const req: Req = (method, url, payload) =>
    t.app.inject({ method, url, headers: { ...ORIGIN_HEADERS, cookie }, ...(payload !== undefined ? { payload: payload as object } : {}) });
  let n = 0;
  return {
    t,
    req,
    async company(name) {
      const res = await req('POST', '/api/v1/companies', { name: name ?? `ТОО ${++n}` });
      if (res.statusCode !== 201) throw new Error(`company: ${res.statusCode} ${res.body}`);
      return (res.json() as { company: { id: number } }).company.id;
    },
    auditCount(entity, action) {
      const row = action
        ? t.sqlite.prepare('SELECT COUNT(*) n FROM audit_log WHERE entity = ? AND action = ?').get(entity, action)
        : t.sqlite.prepare('SELECT COUNT(*) n FROM audit_log WHERE entity = ?').get(entity);
      return (row as { n: number }).n;
    },
  };
}
