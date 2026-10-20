import type { FastifyInstance } from 'fastify';
import { ORIGIN_HEADERS } from './test-app';

/**
 * Ответы API, по которым сверяются две базы с одними данными (перенос SQLite → Postgres, план 2026-10-20-vercel-postgres,
 * задача 17): балансы и «Прибыль» за весь период по каждой компании. Вход — admin с паролем, выданным тестом.
 */
export async function apiReport(app: FastifyInstance, password: string): Promise<Record<string, unknown>> {
  const login = await app.inject({ method: 'POST', url: '/api/v1/auth/login', headers: ORIGIN_HEADERS, payload: { login: 'admin', password } });
  const sid = login.cookies.find((c) => c.name === 'sid');
  if (login.statusCode !== 200 || !sid) throw new Error(`Вход не удался: ${login.statusCode} ${login.body}`);
  const get = async (url: string) => {
    const res = await app.inject({ method: 'GET', url, headers: { ...ORIGIN_HEADERS, cookie: `sid=${sid.value}` } });
    if (res.statusCode !== 200) throw new Error(`${url}: ${res.statusCode} ${res.body.slice(0, 200)}`);
    return res.json() as Record<string, unknown>;
  };
  const companies = (await get('/api/v1/companies')).companies as { id: number }[];
  const out: Record<string, unknown> = {};
  for (const c of companies) {
    const base = `/api/v1/companies/${c.id}`;
    out[c.id] = {
      balances: await get(`${base}/balances`),
      pnl: await get(`${base}/analytics/pnl?from=2024-01-01&to=2026-12-31&step=quarter`),
    };
  }
  return out;
}
