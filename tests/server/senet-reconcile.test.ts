import crypto from 'node:crypto';
import { afterEach, describe, expect, it } from 'vitest';
import { opsWorld, type OpsWorld } from '../helpers/ops';
import { startSenetFake, type SenetFake } from '../helpers/senet-fake';
import { senetSample, xlTime, type SampleValue } from '../helpers/senet-samples';

const KEY = crypto.randomBytes(32).toString('base64');
const session = (open: string, close: string | null, end: number): SampleValue[] => ['Клуб 1', 'Клуб 1', xlTime(open), 'Сотрудник А', close ? xlTime(close) : null, close ? 'Сотрудник А' : null, end, end, 0];
const out = (local: string, amount: number, comment: string): SampleValue[] => ['Клуб 1', xlTime(local), 'Сотрудник А', 'Вынесение', -amount, comment];
const inn = (local: string, amount: number): SampleValue[] => ['Клуб 1', xlTime(local), 'Сотрудник А', 'Внесение средств', amount, null];

const A = session('2026-10-01 10:00:00', '2026-10-01 22:00:00', 10_000);
const B = session('2026-10-01 22:01:00', '2026-10-02 10:00:00', 12_000);
const C = session('2026-10-02 10:01:00', null, 0);
const MOVES = [
  inn('2026-10-01 10:00:05', 8_000),
  out('2026-10-01 21:55:00', 2_000, 'kaspi'),
  out('2026-10-01 21:58:00', 1_500, 'zp op1'),
  // внесение B меньше остатка A — «внесение ≠ остаток прошлой смены»
  inn('2026-10-01 22:01:30', 9_000),
  out('2026-10-02 09:59:00', 3_000, 'kaspi'),
  out('2026-10-02 09:59:30', 500, 'obed'),
  out('2026-10-02 09:59:40', 200, 'что-то'),
];

let x: { w: OpsWorld; fake: SenetFake; base: string; conn: number; office: number; officeBody: Record<string, unknown>; set(s: SampleValue[][]): void } | null = null;
afterEach(async () => {
  await x?.w.h.t.cleanup();
  await x?.fake.close();
  x = null;
});

async function setup() {
  let sessions = [A, B, C];
  const cache = new Map<unknown, Buffer>();
  const sample = (kind: Parameters<typeof senetSample>[0], rows: SampleValue[][]) => cache.get(rows) ?? cache.set(rows, senetSample(kind, rows)).get(rows)!;
  const empty: SampleValue[][] = [];
  const fake = await startSenetFake({
    users: { reports: { password: 'p-1', token: 'tok-1' } },
    report: (type) => (type === 'cashdesk_session' ? sample('sessions', sessions) : type === 'income_outcome' ? sample('cashMoves', MOVES) : sample('transactions', empty)),
  });
  const w = await opsWorld('2026-10-02T06:00:00.000Z', { SENET_API_BASE: fake.base, SECRET_KEY: KEY });
  const base = `/api/v1/companies/${w.cid}/senet`;
  const c = `/api/v1/companies/${w.cid}`;
  const conn = (await w.post(`${base}/connections`, { name: 'К', org: 'club-demo', authMethod: 'password', username: 'reports', password: 'p-1' })).connection.id;
  const kaspi = (await w.post(`${c}/accounts`, { name: 'Kaspi', currency: 'KZT', openedAt: '2026-10-01', startingBalance: 0 })).account.id;
  const salary = (await w.post(`${c}/categories`, { kind: 'expense', name: 'ЗП смены' })).category.id;
  const lunch = (await w.post(`${c}/categories`, { kind: 'expense', name: 'Обед' })).category.id;
  await w.post(`${base}/rules`, { type: 'salary_word', pattern: '', categoryId: salary });
  await w.post(`${base}/rules`, { type: 'lunch', pattern: '', categoryId: lunch });
  await w.post(`${base}/rules`, { type: 'employee_alias', pattern: 'op1', counterpartyId: w.counterparty });
  // журнал после A: 3500 − 1500 = 2000 ₸, Senet — 10 000 ₸: постоянная разница −8000 ₸
  const officeBody = { senetOfficeId: 1, enabled: true, projectId: w.project, cashAccountId: w.kzt, kaspiAccountId: kaspi, incomeCategoryId: w.income, historyFrom: '2026-10-01T04:00:00.000Z', cashOffset: -800_000 };
  const office = (await w.post(`${base}/connections/${conn}/offices`, officeBody)).office.id;
  x = { w, fake, base, conn, office, officeBody, set: (s) => (sessions = s) };
  expect((await w.h.req('POST', `${base}/connections/${conn}/sync`, {})).statusCode).toBe(200);
  return x;
}

const shifts = async (query = '') => (await x!.w.h.req('GET', `${x!.base}/shifts?from=2026-10-01T00:00:00.000Z&to=2026-10-03T00:00:00.000Z${query}`)).json();

/** API «Сверки Senet» (спецификация 2026-11-02-senet-autopost, §8.3; план, задача 13). */
describe('сверка Senet', () => {
  it('строки смен: выручка, Каспи и Касса, выемки, касса после смены Senet / журнал, состояния, первая смена с расхождением', async () => {
    await setup();
    const r = await shifts();
    expect(r.rows.map((s: { states: string[] }) => s.states)).toEqual([['ok'], ['cash_diff', 'review', 'deposit_mismatch'], ['open']]);
    const [a, b] = r.rows;
    expect(a).toMatchObject({ revenue: 550_000, kaspi: { posted: 200_000, senet: 200_000 }, cash: { posted: 350_000, senet: 350_000 }, moves: { posted: 1, total: 2, queued: 0 }, cashAfter: { senet: 200_000, journal: 200_000 } });
    expect(b).toMatchObject({ moves: { posted: 1, total: 3, queued: 1 }, cashAfter: { senet: 400_000 } });
    expect(r.firstCashDiffId).toBe(b.id);
    expect(r.totals).toMatchObject({ revenue: a.revenue + b.revenue });
    expect((await shifts('&onlyDiff=1')).rows.map((s: { id: number }) => s.id)).toEqual([b.id]);
  });

  it('раскрытая смена: выемки с правилом и операцией, доходы, предупреждения', async () => {
    await setup();
    const [, b] = (await shifts()).rows;
    const detail = (await x!.w.h.req('GET', `${x!.base}/shifts/${b.id}`)).json();
    expect(detail.moves.map((m: { comment: string; operationId: number | null }) => [m.comment, m.operationId !== null])).toEqual([
      ['', false],
      ['kaspi', false],
      ['obed', true],
      ['что-то', false],
    ]);
    expect(detail.incomes.map((i: { kind: string }) => i.kind)).toEqual(['kaspi', 'cash']);
    expect(detail.warnings).toEqual(['Внесение не равно остатку прошлой смены']);
  });

  it('Senet изменил смену — «changed»; смена раньше «Загружать с даты» — «not_posted»', async () => {
    await setup();
    x!.set([session('2026-10-01 10:00:00', '2026-10-01 22:00:00', 9_000), B, C]);
    expect((await x!.w.h.req('POST', `${x!.base}/connections/${x!.conn}/sync`, {})).statusCode).toBe(200);
    expect((await shifts()).rows[0].states).toContain('changed');
    await x!.w.h.req('PATCH', `${x!.base}/offices/${x!.office}`, { ...x!.officeBody, historyFrom: '2026-10-01T12:00:00.000Z' });
    expect((await shifts()).rows[0].states).toEqual(['not_posted']);
  });

  it('«Не проводить повторно» снимается и ставится в раскрытой смене — по выемке и доходу', async () => {
    await setup();
    const [, b] = (await shifts()).rows;
    const detail = (await x!.w.h.req('GET', `${x!.base}/shifts/${b.id}`)).json();
    const obed = detail.moves.find((m: { comment: string }) => m.comment === 'obed');
    const set = (body: object) => x!.w.h.req('PATCH', `${x!.base}/shifts/${b.id}/no-repost`, body);
    expect((await set({ kind: 'move', moveId: obed.id, noRepost: true })).statusCode).toBe(200);
    expect((await set({ kind: 'cash', noRepost: true })).statusCode).toBe(200);
    const after = (await x!.w.h.req('GET', `${x!.base}/shifts/${b.id}`)).json();
    expect(after.moves.find((m: { id: number }) => m.id === obed.id).noRepost).toBe(true);
    expect(after.incomes.find((i: { kind: string }) => i.kind === 'cash').noRepost).toBe(true);
    expect((await set({ kind: 'move', moveId: 999_999, noRepost: false })).statusCode).toBe(404);
  });

  it('«Загружать с даты» — предложение: первая смена после последней операции на счёте кассы', async () => {
    await setup();
    const res = await x!.w.h.req('GET', `${x!.base}/offices/${x!.office}/history-from-suggestion`);
    // все смены уже проведены: последняя операция кассы — после B, предлагается C (открыта, но первая без операций)
    expect(res.json()).toEqual({ openedAt: '2026-10-02T05:01:00.000Z' });
  });
});
