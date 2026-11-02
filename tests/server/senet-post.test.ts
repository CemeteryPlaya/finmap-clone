import crypto from 'node:crypto';
import { afterEach, describe, expect, it } from 'vitest';
import { opsWorld, type OpsWorld } from '../helpers/ops';
import { startSenetFake, type SenetFake } from '../helpers/senet-fake';
import { senetSample, xlTime, type SampleValue } from '../helpers/senet-samples';

const KEY = crypto.randomBytes(32).toString('base64');
const NOW = '2026-10-02T06:00:00.000Z';

const session = (open: string, close: string | null, end: number): SampleValue[] => ['Клуб 1', 'Клуб 1', xlTime(open), 'Сотрудник А', close ? xlTime(close) : null, close ? 'Сотрудник А' : null, end, end, 0];
const move = (local: string, type: 'Внесение средств' | 'Вынесение', amount: number, comment: string | null): SampleValue[] => [
  'Клуб 1',
  xlTime(local),
  'Сотрудник А',
  type,
  type === 'Вынесение' ? -amount : amount,
  comment,
];
const A = session('2026-10-01 10:00:00', '2026-10-01 22:00:00', 10_000);
const B = session('2026-10-01 22:01:00', '2026-10-02 10:00:00', 12_000);
const MOVES = [
  move('2026-10-01 10:00:05', 'Внесение средств', 8_000, null),
  move('2026-10-01 21:55:00', 'Вынесение', 2_000, 'kaspi'),
  move('2026-10-01 21:58:00', 'Вынесение', 1_500, 'zp op1'),
  move('2026-10-01 22:01:30', 'Внесение средств', 10_000, null),
  move('2026-10-02 09:59:00', 'Вынесение', 3_000, 'kaspi'),
  move('2026-10-02 09:59:30', 'Вынесение', 500, 'obed'),
  move('2026-10-02 09:59:30', 'Вынесение', 500, 'obed'),
];

interface World {
  w: OpsWorld;
  fake: SenetFake;
  set(o: { sessions?: SampleValue[][]; moves?: SampleValue[][] }): void;
  sync(): Promise<void>;
  ops(): Promise<{ id: number; paidAt: string; accountId: number; amount: number; categoryId: number; counterpartyId: number | null; projectId: number; accrualDate: string; comment: string | null; deleted: boolean }[]>;
  base: string;
  kaspi: number;
  salary: number;
  lunch: number;
  water: number;
}

let world: World | null = null;
afterEach(async () => {
  await world?.w.h.t.cleanup();
  await world?.fake.close();
  world = null;
});

async function setup(o: { historyFrom?: string; windowedMoves?: boolean } = {}): Promise<World> {
  let sessions = [A, B];
  let moves = [...MOVES];
  const cache = new Map<unknown, Buffer>();
  const sample = (kind: Parameters<typeof senetSample>[0], rows: SampleValue[][]) => cache.get(rows) ?? cache.set(rows, senetSample(kind, rows)).get(rows)!;
  const fake = await startSenetFake({
    users: { reports: { password: 'p-1', token: 'tok-1' } },
    report: (type, q) => {
      if (type === 'cashdesk_session') return sample('sessions', sessions);
      if (type !== 'income_outcome') return sample('transactions', []);
      if (!o.windowedMoves) return sample('cashMoves', moves);
      // выемки — строго в окне запроса (дата Excel в часах клуба, UTC+5)
      const utc = (r: SampleValue[]) => Math.round(((r[1] as { value: number }).value - 25_569) * 86_400_000) - 5 * 3_600_000;
      return senetSample('cashMoves', moves.filter((r) => utc(r) >= Date.parse(q.from_date!) && utc(r) < Date.parse(q.to_date!)));
    },
  });
  const w = await opsWorld(NOW, { SENET_API_BASE: fake.base, SECRET_KEY: KEY });
  const base = `/api/v1/companies/${w.cid}/senet`;
  const c = `/api/v1/companies/${w.cid}`;
  const conn = (await w.post(`${base}/connections`, { name: 'К', org: 'club-demo', authMethod: 'password', username: 'reports', password: 'p-1' })).connection.id;
  const kaspi = (await w.post(`${c}/accounts`, { name: 'Kaspi', currency: 'KZT', openedAt: '2026-10-01', startingBalance: 0 })).account.id;
  const salary = (await w.post(`${c}/categories`, { kind: 'expense', name: 'ЗП смены' })).category.id;
  const lunch = (await w.post(`${c}/categories`, { kind: 'expense', name: 'Обед' })).category.id;
  const water = (await w.post(`${c}/categories`, { kind: 'expense', name: 'Вода' })).category.id;
  await w.post(`${base}/rules`, { type: 'salary_word', pattern: '', categoryId: salary });
  await w.post(`${base}/rules`, { type: 'lunch', pattern: '', categoryId: lunch });
  await w.post(`${base}/rules`, { type: 'employee_alias', pattern: 'op1', counterpartyId: w.counterparty });
  await w.post(`${base}/rules`, { type: 'keyword', pattern: 'voda', match: 'phrase', categoryId: water });
  await w.post(`${base}/connections/${conn}/offices`, {
    senetOfficeId: 1,
    enabled: true,
    projectId: w.project,
    cashAccountId: w.kzt,
    kaspiAccountId: kaspi,
    incomeCategoryId: w.income,
    historyFrom: o.historyFrom ?? '2026-10-01T04:00:00.000Z',
  });
  const result: World = {
    w,
    fake,
    base,
    kaspi,
    salary,
    lunch,
    water,
    set(x) {
      if (x.sessions) sessions = x.sessions;
      if (x.moves) moves = x.moves;
    },
    async sync() {
      const res = await w.h.req('POST', `${base}/connections/${conn}/sync`, {});
      expect(res.statusCode, res.body).toBe(200);
    },
    async ops() {
      const rows = await w.h.t.q(
        'SELECT o.id, o.paid_at, o.account_id, o.amount, l.category_id, o.counterparty_id, l.project_id, o.accrual_date, o.comment, o.deleted_at FROM operations o JOIN operation_lines l ON l.operation_id = o.id ORDER BY o.paid_at, o.id',
      );
      return rows.map((r) => ({
        id: Number(r.id),
        paidAt: String(r.paid_at),
        accountId: Number(r.account_id),
        amount: Number(r.amount),
        categoryId: Number(r.category_id),
        counterpartyId: r.counterparty_id === null ? null : Number(r.counterparty_id),
        projectId: Number(r.project_id),
        accrualDate: String(r.accrual_date),
        comment: r.comment === null ? null : String(r.comment),
        deleted: r.deleted_at !== null,
      }));
    },
  };
  world = result;
  return result;
}

const live = (ops: Awaited<ReturnType<World['ops']>>) => ops.filter((o) => !o.deleted);

/** Автопроводка смен (спецификация 2026-11-02-senet-autopost, §5; план, задача 11). */
describe('автопроводка Senet', () => {
  it('закрытые смены проводятся по плану: счета, категории, контрагенты, проект, время, дата начисления', async () => {
    const x = await setup();
    await x.sync();
    const ops = await x.ops();
    expect(ops.map((o) => [o.paidAt, o.accountId, o.amount, o.categoryId, o.counterpartyId, o.accrualDate])).toEqual([
      ['2026-10-01T17:00:00.000Z', x.w.kzt, 150_000, x.salary, x.w.counterparty, '2026-10-01'],
      ['2026-10-01T17:01:00.000Z', x.kaspi, 200_000, x.w.income, null, '2026-10-01'],
      ['2026-10-01T17:01:00.000Z', x.w.kzt, 350_000, x.w.income, null, '2026-10-01'],
      ['2026-10-02T05:00:00.000Z', x.w.kzt, 50_000, x.lunch, null, '2026-10-02'],
      ['2026-10-02T05:00:00.000Z', x.w.kzt, 50_000, x.lunch, null, '2026-10-02'],
      ['2026-10-02T05:01:00.000Z', x.kaspi, 300_000, x.w.income, null, '2026-10-02'],
      ['2026-10-02T05:01:00.000Z', x.w.kzt, 300_000, x.w.income, null, '2026-10-02'],
    ]);
    expect(ops.every((o) => o.projectId === x.w.project)).toBe(true);
    expect(await x.w.h.auditCount('senet_shift', 'post')).toBe(2);
    // повторный забор дублей не создаёт
    await x.sync();
    expect(await x.ops()).toHaveLength(7);
  });

  it('смена раньше «Загружать с даты» не проводится; открытая — только после закрытия', async () => {
    const x = await setup({ historyFrom: '2026-10-01T12:00:00.000Z' });
    x.set({ sessions: [A, B, session('2026-10-02 10:01:00', null, 12_000)], moves: [...MOVES, move('2026-10-02 10:30:00', 'Вынесение', 100, 'voda')] });
    await x.sync();
    expect((await x.ops()).map((o) => o.paidAt.slice(0, 10))).toEqual(Array(4).fill('2026-10-02'));
    x.set({ sessions: [A, B, session('2026-10-02 10:01:00', '2026-10-02 10:50:00', 12_000)] });
    await x.sync();
    expect((await x.ops()).filter((o) => o.categoryId === x.water)).toHaveLength(1);
  });

  it('сбой посреди смены: смена откатывается целиком и получает post_error, соседняя проведена', async () => {
    const x = await setup();
    await x.w.h.t.failOn('senet_fail_b', { table: 'operations', event: 'INSERT', message: 'сбой записи', when: 'NEW.amount = 300000' });
    await x.sync();
    expect((await x.ops()).map((o) => o.paidAt.slice(0, 10))).toEqual(['2026-10-01', '2026-10-01', '2026-10-01']);
    const errors = await x.w.h.t.q('SELECT opened_at, post_error FROM senet_shifts ORDER BY opened_at');
    expect(errors[0]!.post_error).toBeNull();
    expect(String(errors[1]!.post_error)).toContain('сбой записи');
    await x.w.h.t.dropFail('senet_fail_b', 'operations');
    await x.sync();
    expect(await x.ops()).toHaveLength(7);
    expect((await x.w.h.t.q('SELECT post_error FROM senet_shifts')).every((r) => r.post_error === null)).toBe(true);
  });

  it('удалённая операция проводится заново; с «Не проводить повторно» — нет', async () => {
    const x = await setup();
    await x.sync();
    const zp = (await x.ops()).find((o) => o.categoryId === x.salary)!;
    expect((await x.w.h.req('DELETE', `${x.w.ops}/${zp.id}`)).statusCode).toBe(200);
    await x.sync();
    const again = live(await x.ops()).find((o) => o.categoryId === x.salary)!;
    expect(again.id).not.toBe(zp.id);
    expect(await x.w.h.t.q("SELECT operation_id o, prev_operation_id p FROM senet_cash_moves WHERE comment = 'zp op1'")).toEqual([{ o: again.id, p: zp.id }]);

    const lunch = live(await x.ops()).find((o) => o.categoryId === x.lunch)!;
    expect((await x.w.h.req('PATCH', `${x.base}/links/${lunch.id}`, { noRepost: true })).statusCode).toBe(200);
    await x.w.h.req('DELETE', `${x.w.ops}/${lunch.id}`);
    const cashIncome = live(await x.ops()).find((o) => o.accountId === x.w.kzt && o.categoryId === x.w.income)!;
    await x.w.h.req('PATCH', `${x.base}/links/${cashIncome.id}`, { noRepost: true });
    await x.w.h.req('DELETE', `${x.w.ops}/${cashIncome.id}`);
    await x.sync();
    expect(live(await x.ops())).toHaveLength(5);
    expect((await x.w.h.req('PATCH', `${x.base}/links/999999`, { noRepost: true })).statusCode).toBe(404);
  });

  it('связь операции с Senet — для окна удаления', async () => {
    const x = await setup();
    await x.sync();
    const ops = await x.ops();
    const zp = ops.find((o) => o.categoryId === x.salary)!;
    const kaspi = ops.find((o) => o.accountId === x.kaspi)!;
    expect((await x.w.h.req('GET', `${x.base}/links/${zp.id}`)).json()).toEqual({ link: { shiftId: expect.any(Number), kind: 'move', noRepost: false } });
    expect((await x.w.h.req('GET', `${x.base}/links/${kaspi.id}`)).json().link.kind).toBe('kaspi');
    const manual = (await x.w.post(x.w.ops, { type: 'expense', paidAt: '2026-10-02T03:00:00Z', accountId: x.w.kzt, amount: 100, lines: [{ categoryId: x.w.expense, amount: 100 }] })).operation.id;
    expect((await x.w.h.req('GET', `${x.base}/links/${manual}`)).json()).toEqual({ link: null });
  });

  it('Senet изменил выручку после проведения — отметка без корректировки; «Перепровести доходы смены»', async () => {
    const x = await setup();
    await x.sync();
    x.set({ sessions: [session('2026-10-01 10:00:00', '2026-10-01 22:00:00', 9_000), B] });
    await x.sync();
    const [a] = await x.w.h.t.q('SELECT id, changed_after_post c FROM senet_shifts ORDER BY opened_at');
    expect(Boolean(a!.c)).toBe(true);
    const cash = async () => live(await x.ops()).find((o) => o.accountId === x.w.kzt && o.categoryId === x.w.income && o.paidAt.startsWith('2026-10-01'))!.amount;
    expect(await cash()).toBe(350_000);
    const res = await x.w.h.req('POST', `${x.base}/shifts/${a!.id}/repost-incomes`, {});
    expect(res.statusCode, res.body).toBe(200);
    expect(await cash()).toBe(250_000);
    expect(Boolean((await x.w.h.t.q('SELECT changed_after_post c FROM senet_shifts WHERE id = ?', a!.id))[0]!.c)).toBe(false);
  });

  it('забор несколькими отрезками: смена проводится в отрезке, где пришли все её выемки', async () => {
    const x = await setup({ windowedMoves: true });
    // Senet отдаёт смены без учёта окна: смена A есть уже в первом отрезке, а её выемки — только во втором
    const res = await x.w.h.req('POST', `${x.base}/connections/${(await x.w.h.t.q('SELECT id FROM senet_connections'))[0]!.id}/sync`, {
      from: '2026-09-24T07:00:00.000Z',
      to: '2026-10-02T06:00:00.000Z',
    });
    expect(res.json().runs[0].counts.chunks).toBe(2);
    const ops = await x.ops();
    expect(ops.map((o) => [o.paidAt, o.amount])).toEqual([
      ['2026-10-01T17:00:00.000Z', 150_000],
      ['2026-10-01T17:01:00.000Z', 200_000],
      ['2026-10-01T17:01:00.000Z', 350_000],
      ['2026-10-02T05:00:00.000Z', 50_000],
      ['2026-10-02T05:00:00.000Z', 50_000],
      ['2026-10-02T05:01:00.000Z', 300_000],
      ['2026-10-02T05:01:00.000Z', 300_000],
    ]);
    expect((await x.w.h.t.q('SELECT changed_after_post c FROM senet_shifts')).every((r) => !r.c)).toBe(true);
  });

  it('поздняя выемка проведённой смены — после её выемок, до доходов; две одинаковые выемки — две операции', async () => {
    const x = await setup();
    await x.sync();
    x.set({ moves: [...MOVES, move('2026-10-01 21:59:00', 'Вынесение', 700, 'voda')] });
    await x.sync();
    const water = live(await x.ops()).filter((o) => o.categoryId === x.water);
    expect(water.map((o) => [o.paidAt, o.amount])).toEqual([['2026-10-01T17:00:00.000Z', 70_000]]);
    expect(live(await x.ops()).filter((o) => o.categoryId === x.lunch)).toHaveLength(2);
  });
});
