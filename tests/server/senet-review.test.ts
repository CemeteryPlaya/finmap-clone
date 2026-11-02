import crypto from 'node:crypto';
import { afterEach, describe, expect, it } from 'vitest';
import { opsWorld, type OpsWorld } from '../helpers/ops';
import { startSenetFake, type SenetFake } from '../helpers/senet-fake';
import { senetSample, xlTime, type SampleValue } from '../helpers/senet-samples';

const KEY = crypto.randomBytes(32).toString('base64');
const session = (open: string, close: string, end: number): SampleValue[] => ['Клуб 1', 'Клуб 1', xlTime(open), 'Сотрудник А', xlTime(close), 'Сотрудник А', end, end, 0];
const out = (local: string, amount: number, comment: string): SampleValue[] => ['Клуб 1', xlTime(local), 'Сотрудник А', 'Вынесение', -amount, comment];
const inn = (local: string, amount: number): SampleValue[] => ['Клуб 1', xlTime(local), 'Сотрудник А', 'Внесение средств', amount, null];

// A — разные причины выемок; B — без выноса kaspi (и та же «что-то»); C — касса меньше нуля
const SESSIONS = [
  session('2026-10-01 10:00:00', '2026-10-01 22:00:00', 10_000),
  session('2026-10-01 22:01:00', '2026-10-02 10:00:00', 12_000),
  session('2026-10-02 10:01:00', '2026-10-02 12:00:00', 0),
];
const MOVES = [
  inn('2026-10-01 10:00:05', 8_000),
  out('2026-10-01 21:50:00', 2_000, 'kaspi'),
  out('2026-10-01 21:51:00', 300, 'что-то'),
  out('2026-10-01 21:52:00', 400, 'op1'),
  out('2026-10-01 21:53:00', 500, 'zp'),
  out('2026-10-01 21:54:00', 600, 'voda'),
  inn('2026-10-01 22:01:30', 10_000),
  out('2026-10-02 09:58:00', 300, 'что-то'),
  inn('2026-10-02 10:01:10', 12_000),
  out('2026-10-02 11:59:00', 1_000, 'kaspi'),
];

let x: { w: OpsWorld; fake: SenetFake; base: string; conn: number; kaspi: number; salary: number; water: number; other: number } | null = null;
afterEach(async () => {
  await x?.w.h.t.cleanup();
  await x?.fake.close();
  x = null;
});

async function setup() {
  const cache = new Map<string, Buffer>();
  const sample = (kind: Parameters<typeof senetSample>[0], rows: SampleValue[][]) => cache.get(kind) ?? cache.set(kind, senetSample(kind, rows)).get(kind)!;
  const fake = await startSenetFake({
    users: { reports: { password: 'p-1', token: 'tok-1' } },
    report: (type) => (type === 'cashdesk_session' ? sample('sessions', SESSIONS) : type === 'income_outcome' ? sample('cashMoves', MOVES) : sample('transactions', [])),
  });
  const w = await opsWorld('2026-10-03T06:00:00.000Z', { SENET_API_BASE: fake.base, SECRET_KEY: KEY });
  const base = `/api/v1/companies/${w.cid}/senet`;
  const c = `/api/v1/companies/${w.cid}`;
  const conn = (await w.post(`${base}/connections`, { name: 'К', org: 'club-demo', authMethod: 'password', username: 'reports', password: 'p-1' })).connection.id;
  const kaspi = (await w.post(`${c}/accounts`, { name: 'Kaspi', currency: 'KZT', openedAt: '2026-10-01', startingBalance: 0 })).account.id;
  const salary = (await w.post(`${c}/categories`, { kind: 'expense', name: 'ЗП смены' })).category.id;
  const water = (await w.post(`${c}/categories`, { kind: 'expense', name: 'Вода' })).category.id;
  const other = (await w.post(`${c}/categories`, { kind: 'expense', name: 'Прочее' })).category.id;
  await w.post(`${base}/rules`, { type: 'salary_word', pattern: '', categoryId: salary });
  await w.post(`${base}/rules`, { type: 'employee_alias', pattern: 'op1', counterpartyId: w.counterparty });
  await w.post(`${base}/rules`, { type: 'keyword', pattern: 'voda', match: 'phrase', categoryId: water });
  await w.h.req('POST', `${c}/categories/${water}/archive`);
  await w.post(`${base}/connections/${conn}/offices`, {
    senetOfficeId: 1,
    enabled: true,
    projectId: w.project,
    cashAccountId: w.kzt,
    kaspiAccountId: kaspi,
    incomeCategoryId: w.income,
    historyFrom: '2026-10-01T04:00:00.000Z',
  });
  x = { w, fake, base, conn, kaspi, salary, water, other };
  return x;
}

const sync = async () => expect((await x!.w.h.req('POST', `${x!.base}/connections/${x!.conn}/sync`, {})).statusCode).toBe(200);
const items = async (status = 'open') => (await x!.w.h.req('GET', `${x!.base}/review?status=${status}`)).json().items as { id: number; reason: string; comment: string | null; amount: number | null; suggestions: unknown[]; status: string }[];
const answer = (id: number, body: object) => x!.w.h.req('POST', `${x!.base}/review/${id}/answer`, body);
const ops = async () => x!.w.h.t.q('SELECT o.id, o.account_id a, o.amount, l.category_id c, o.counterparty_id cp, o.paid_at p, o.deleted_at d FROM operations o JOIN operation_lines l ON l.operation_id = o.id ORDER BY o.id');

/** Очередь «Разобрать» (спецификация 2026-11-02-senet-autopost, §6; план, задача 12). */
describe('очередь «Разобрать»', () => {
  it('каждая причина появляется при заборе; повторный забор пунктов не дублирует', async () => {
    await setup();
    await sync();
    const reasons = (await items()).map((i) => `${i.reason}:${i.comment ?? ''}`).sort();
    expect(reasons).toEqual(['name_only:op1', 'negative_cash:', 'no_kaspi:', 'rule_broken:voda', 'salary_no_name:zp', 'unrecognized:что-то', 'unrecognized:что-то'].sort());
    expect((await items()).find((i) => i.reason === 'name_only')!.suggestions[0]).toMatchObject({ categoryId: x!.salary, counterpartyId: x!.w.counterparty });
    await sync();
    expect(await items()).toHaveLength(7);
  });

  it('ответ расходом создаёт операцию; «Запомнить» — точное правило и закрывает такой же пункт', async () => {
    await setup();
    await sync();
    const [first] = (await items()).filter((i) => i.comment === 'что-то');
    const before = (await ops()).length;
    const res = await answer(first!.id, { kind: 'expense', categoryId: x!.other, counterpartyId: null, comment: 'разное', remember: true });
    expect(res.statusCode, res.body).toBe(200);
    expect(res.json().item).toMatchObject({ status: 'answered' });
    expect((await ops()).length).toBe(before + 2);
    const rule = await x!.w.h.t.q("SELECT type, pattern, category_id c, created_from_review f FROM senet_rules WHERE type = 'exact'");
    expect(rule).toEqual([{ type: 'exact', pattern: 'что то', c: x!.other, f: rule[0]!.f }]);
    expect(Boolean(rule[0]!.f)).toBe(true);
    expect((await items()).filter((i) => i.comment === 'что-то')).toEqual([]);
    const answered = await x!.w.h.t.q("SELECT answered_by b, answered_via v FROM senet_review_items WHERE status = 'answered' ORDER BY id");
    expect(answered.map((a) => a.v)).toEqual(['web', 'web']);
    expect((await answer(first!.id, { kind: 'dismiss' })).statusCode).toBe(409);
  });

  it('пустой комментарий запомнить нельзя', async () => {
    await setup();
    await sync();
    await x!.w.h.t.q("UPDATE senet_cash_moves SET comment = '' WHERE comment = 'op1'");
    const item = (await items()).find((i) => i.reason === 'name_only')!;
    const res = await answer(item.id, { kind: 'expense', categoryId: x!.other, counterpartyId: null, comment: null, remember: true });
    expect([res.statusCode, res.json().error.message]).toEqual([422, 'Нельзя запомнить пустой комментарий']);
  });

  it('нет выноса kaspi: «Указать Каспи» — доход Каспи и Касса меньше; «Каспи не было» — без операций', async () => {
    await setup();
    await sync();
    const noKaspi = (await items()).find((i) => i.reason === 'no_kaspi')!;
    const cashBefore = (await ops()).find((o) => o.a === x!.w.kzt && o.c === x!.w.income && String(o.p).startsWith('2026-10-02T05'))!;
    const res = await answer(noKaspi.id, { kind: 'kaspi', amount: 20_000 });
    expect(res.statusCode, res.body).toBe(200);
    const after = await ops();
    expect(after.find((o) => o.id === cashBefore.id)!.amount).toBe(Number(cashBefore.amount) - 20_000);
    expect(after.filter((o) => o.a === x!.kaspi && String(o.p).startsWith('2026-10-02T05')).map((o) => o.amount)).toEqual([20_000]);
  });

  it('касса меньше нуля: доходы вручную; «Пропустить» выемку — следующий забор её не возвращает', async () => {
    await setup();
    await sync();
    const negative = (await items()).find((i) => i.reason === 'negative_cash')!;
    expect((await answer(negative.id, { kind: 'incomes', kaspi: 100_000, cash: 5_000 })).statusCode).toBe(200);
    expect((await ops()).filter((o) => String(o.p).startsWith('2026-10-02T07')).map((o) => [o.a, o.amount])).toEqual([
      [x!.kaspi, 100_000],
      [x!.w.kzt, 5_000],
    ]);
    const zp = (await items()).find((i) => i.reason === 'salary_no_name')!;
    expect((await answer(zp.id, { kind: 'dismiss' })).statusCode).toBe(200);
    await sync();
    expect((await items()).find((i) => i.reason === 'salary_no_name')).toBeUndefined();
    expect((await items('dismissed')).map((i) => i.reason)).toEqual(['salary_no_name']);
  });

  it('ручное распределение доходов — не «изменение Senet»: повторный забор, «Перепровести» и повторная проводка его сохраняют', async () => {
    await setup();
    await sync();
    const noKaspi = (await items()).find((i) => i.reason === 'no_kaspi')!;
    const negative = (await items()).find((i) => i.reason === 'negative_cash')!;
    await answer(noKaspi.id, { kind: 'kaspi', amount: 20_000 });
    await answer(negative.id, { kind: 'incomes', kaspi: 100_000, cash: 5_000 });
    await sync();
    const flags = await x!.w.h.t.q('SELECT changed_after_post c FROM senet_shifts ORDER BY opened_at');
    expect(flags.map((f) => Boolean(f.c))).toEqual([false, false, false]);

    const [, b] = await x!.w.h.t.q('SELECT id FROM senet_shifts ORDER BY opened_at');
    const incomesB = async () =>
      (await ops()).filter((o) => o.d === null && String(o.p).startsWith('2026-10-02T05') && o.c === x!.w.income).map((o) => [o.a, Number(o.amount)]).sort();
    const before = await incomesB();
    expect(before).toEqual([...before].sort());
    expect((await x!.w.h.req('POST', `${x!.base}/shifts/${b!.id}/repost-incomes`, {})).statusCode).toBe(200);
    expect(await incomesB()).toEqual(before);

    // удалённую «Кассу» повторная проводка возвращает на ручную сумму, не на полную — Каспи не задваивается
    const cash = (await ops()).find((o) => o.d === null && o.a === x!.w.kzt && o.c === x!.w.income && String(o.p).startsWith('2026-10-02T05'))!;
    await x!.w.h.req('DELETE', `/api/v1/companies/${x!.w.cid}/operations/${cash.id}`);
    await sync();
    expect(await incomesB()).toEqual(before);
  });

  it('ответ через Telegram — тот же сервис, via = telegram', async () => {
    await setup();
    await sync();
    const item = (await items()).find((i) => i.reason === 'unrecognized')!;
    await x!.w.h.t.app.senet.review.answer(x!.w.cid, item.id, { kind: 'dismiss' }, { userId: 1, via: 'telegram' });
    expect(await x!.w.h.t.q('SELECT answered_via v, status s FROM senet_review_items WHERE id = ?', item.id)).toEqual([{ v: 'telegram', s: 'dismissed' }]);
  });

  it('выемка стала распознаваться — следующий забор проводит её и закрывает пункт', async () => {
    await setup();
    await sync();
    await x!.w.post(`${x!.base}/rules`, { type: 'keyword', pattern: 'что', match: 'first', categoryId: x!.other });
    await sync();
    expect((await items()).filter((i) => i.comment === 'что-то')).toEqual([]);
    expect((await ops()).filter((o) => o.c === x!.other)).toHaveLength(2);
  });
});
