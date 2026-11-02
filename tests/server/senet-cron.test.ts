import crypto from 'node:crypto';
import { afterEach, describe, expect, it } from 'vitest';
import { startSenetFake, type SenetFake } from '../helpers/senet-fake';
import { senetSample, TWO_SHIFTS } from '../helpers/senet-samples';
import { VERCEL_ENV, vercelWorld, type VercelWorld } from '../helpers/vercel';

const NOW = new Date('2026-10-06T06:05:00.000Z');
let w: VercelWorld | null = null;
let fake: SenetFake | null = null;
afterEach(async () => {
  await w?.t.cleanup();
  await fake?.close();
  w = null;
  fake = null;
});

const cron = (v: VercelWorld, authorization?: string) => v.t.app.inject({ method: 'GET', url: '/api/v1/cron/senet', headers: authorization ? { authorization } : {} });
const BEARER = `Bearer ${'c'.repeat(16)}`;

async function world() {
  fake = await startSenetFake({ users: { reports: { password: 'p-1', token: 'tok-1' } }, report: (type) =>
      type === 'cashdesk_session' ? senetSample('sessions', TWO_SHIFTS) : senetSample(type === 'income_outcome' ? 'cashMoves' : 'transactions', []),
  });
  w = await vercelWorld({ ...VERCEL_ENV, SENET_API_BASE: fake.base, SECRET_KEY: crypto.randomBytes(32).toString('base64') }, {}, NOW);
  const base = `/api/v1/companies/${w.cid}/senet`;
  const ok = async (method: 'POST', url: string, body: object) => {
    const res = await w!.req(method, url, body);
    expect(res.statusCode, res.body).toBeLessThan(300);
    return res.json();
  };
  const conn = (await ok('POST', `${base}/connections`, { name: 'К', org: 'club-demo', authMethod: 'password', username: 'reports', password: 'p-1' })).connection.id;
  const project = (await ok('POST', `/api/v1/companies/${w.cid}/projects`, { name: 'Клуб 1', templateKey: 'general' })).project.id;
  const income = (await ok('POST', `/api/v1/companies/${w.cid}/categories`, { kind: 'income', name: 'За смену клуба' })).category.id;
  const kaspi = (await ok('POST', `/api/v1/companies/${w.cid}/accounts`, { name: 'Kaspi', currency: 'KZT', openedAt: '2026-10-01', startingBalance: 0 })).account.id;
  await ok('POST', `${base}/connections/${conn}/offices`, {
    senetOfficeId: 1,
    enabled: true,
    projectId: project,
    cashAccountId: w.account,
    kaspiAccountId: kaspi,
    incomeCategoryId: income,
    historyFrom: '2026-10-01T00:00:00.000Z',
  });
  return { conn };
}

/** Забор по расписанию на Vercel (план 2026-11-02-senet-autopost, задача 7). */
describe('GET /api/v1/cron/senet', () => {
  it('без Bearer CRON_SECRET — 401, Senet не опрашивается', async () => {
    const v = (await world(), w!);
    for (const auth of [undefined, 'Bearer wrong-secret-wrong']) expect((await cron(v, auth)).statusCode).toBe(401);
    expect(fake!.requests).toHaveLength(0);
  });

  it('с секретом — забор всех подключений, ответ — итоги запусков', async () => {
    const { conn } = await world();
    const res = await cron(w!, BEARER);
    expect(res.statusCode, res.body).toBe(200);
    expect(res.json().runs).toEqual([expect.objectContaining({ connectionId: conn, result: 'ok', budgetExceeded: false })]);
    expect((await w!.t.q('SELECT trigger FROM senet_sync_runs'))[0]!.trigger).toBe('cron');
    expect((await w!.t.q('SELECT COUNT(*) n FROM senet_shifts'))[0]!.n).toBe(2);
  });

  it('пока идёт другой забор (свежий незавершённый запуск) — 409 SENET_SYNC_RUNNING', async () => {
    const { conn } = await world();
    await w!.t.q("INSERT INTO senet_sync_runs (connection_id, started_at, trigger) VALUES (?, '2026-10-06T06:04:00.000Z', 'cron')", conn);
    const res = await cron(w!, BEARER);
    expect(res.statusCode).toBe(409);
    expect(res.json().error.code).toBe('SENET_SYNC_RUNNING');
    // зависший запуск (старше 10 минут) не мешает
    await w!.t.q("UPDATE senet_sync_runs SET started_at = '2026-10-06T05:50:00.000Z'");
    expect((await cron(w!, BEARER)).statusCode).toBe(200);
  });
});
