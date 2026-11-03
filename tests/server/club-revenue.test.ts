import crypto from 'node:crypto';
import { afterEach, describe, expect, it } from 'vitest';
import { revenueSheet } from '../../src/server/modules/club-analytics/revenue';
import { opsWorld, type OpsWorld } from '../helpers/ops';
import { startSenetFake, type SenetFake } from '../helpers/senet-fake';
import { senetSample, xlTime, type SampleValue } from '../helpers/senet-samples';

/** «Выручка клуба» — API (спецификация «Аналитика клуба», §5, §3.3–3.4; план АК-1, задача 5). Деньги образцов — тенге, ответа — тиыны. */
const KEY = crypto.randomBytes(32).toString('base64');
const session = (open: string, close: string, end: number): SampleValue[] => ['Клуб 1', 'Клуб 1', xlTime(open), 'Сотрудник А', xlTime(close), 'Сотрудник А', end, end, 0];
const move = (local: string, type: 'Внесение средств' | 'Вынесение', amount: number, comment: string | null): SampleValue[] => ['Клуб 1', xlTime(local), 'Сотрудник А', type, type === 'Вынесение' ? -amount : amount, comment];
const tx = (local: string, amount: number, payment: string): SampleValue[] => ['Клуб 1', '01.11.2026-02.11.2026', xlTime(local), `T${local}`, 'Покупка чека', amount, payment];
const sold = (local: string, item: string, qty: number | null, amount: number): SampleValue[] => [xlTime(local), item, qty, amount, 'Наличный расчет', 'Использовано', null];
const refill = (local: string, type: string, amount: number): SampleValue[] => ['Клуб 1', xlTime(local), 'гость1', type, 77012345612, amount, 7];
const load = (open: string, close: string, zone: string, ws: number, login: string, debited: number): SampleValue[] => ['Клуб 1', xlTime(open), xlTime(close), zone, ws, login, '+77012345612', 19, 'Тариф 1', debited, 0, 0.0625];

// смены: дневная 01.11, ночная 01.11 22:01 — 02.11 10:00, дневная 02.11; выручка смены = остаток − внесение + выемки
const SESSIONS = [session('2026-11-01 10:00:00', '2026-11-01 22:00:00', 3_000), session('2026-11-01 22:01:00', '2026-11-02 10:00:00', 4_000), session('2026-11-02 10:01:00', '2026-11-02 22:00:00', 5_000)];
const MOVES = [move('2026-11-01 10:00:05', 'Внесение средств', 1_000, null), move('2026-11-01 22:01:30', 'Внесение средств', 3_000, null), move('2026-11-02 10:01:30', 'Внесение средств', 4_000, null), move('2026-11-02 21:00:00', 'Вынесение', 500, 'obed')];
const DATA = {
  tx: [tx('2026-11-01 12:00:00', 2_000, 'Наличный расчет'), tx('2026-11-01 23:00:00', 1_000, 'Безналичный расчет'), tx('2026-11-02 15:00:00', 1_500, 'Наличный расчет')],
  sold: [sold('2026-11-01 12:00:00', 'Напиток 1', 2, 1_500), sold('2026-11-01 12:00:00', 'A1B2', null, 1_000), sold('2026-11-02 15:00:00', 'Напиток 1', 1, 750)],
  refills: [refill('2026-11-01 20:00:00', 'General', 500), refill('2026-11-02 11:00:00', 'Check', 1_000)],
  load: [load('2026-11-01 20:00:00', '2026-11-01 21:30:00', 'VIP', 7, 'гость1', 900), load('2026-11-01 23:30:00', '2026-11-02 01:00:00', 'Общий', 3, 'гость2', 600), load('2026-11-02 14:00:00', '2026-11-02 15:00:00', 'Общий', 3, 'гость2', 400)],
};
const T = (tenge: number) => tenge * 100;

let x: { w: OpsWorld; fake: SenetFake; c: string; conn: number; club: number; office: number } | null = null;
afterEach(async () => {
  await x?.w.h.t.cleanup();
  await x?.fake.close();
  x = null;
});

/** Строки окна запроса: время — в колонке col (число Excel в часах клуба, UTC+5). */
const inWindow = (rows: SampleValue[][], col: number, q: Record<string, string>) =>
  rows.filter((r) => {
    const ms = Math.round(((r[col] as { value: number }).value - 25_569) * 86_400_000) - 5 * 3_600_000;
    return ms >= Date.parse(q.from_date!) && ms < Date.parse(q.to_date!);
  });

async function setup(data = DATA) {
  const fake = await startSenetFake({
    users: { reports: { password: 'p-1', token: 'tok-1' } },
    ownAnalytics: true,
    report: (type, q) => {
      const pick: Record<string, () => Buffer> = {
        cashdesk_session: () => senetSample('sessions', SESSIONS),
        income_outcome: () => senetSample('cashMoves', MOVES),
        cashdesk_transactions: () => senetSample('transactions', inWindow(data.tx, 2, q)),
        sold_check_items: () => senetSample('soldItems', inWindow(data.sold, 0, q)),
        refill: () => senetSample('refills', inWindow(data.refills, 1, q)),
        office_load_by_zones: () => senetSample('load', inWindow(data.load, 1, q)),
      };
      return (pick[type] ?? (() => senetSample(type === 'checks' ? 'checks' : type === 'shop_quantity' ? 'stock' : 'goodsMoves', [])))();
    },
  });
  const w = await opsWorld('2026-11-03T06:00:00.000Z', { SENET_API_BASE: fake.base, SECRET_KEY: KEY });
  const c = `/api/v1/companies/${w.cid}`;
  const club = (await w.post(`${c}/projects`, { name: 'Клуб 3', templateKey: 'computer-club', templateParams: { pcCount: 10 } })).project.id as number;
  const conn = (await w.post(`${c}/senet/connections`, { name: 'К', org: 'club-demo', authMethod: 'password', username: 'reports', password: 'p-1' })).connection.id as number;
  // клуб выключен, но привязан к проекту — учитывается; второй клуб без проекта — нет (Review Focus 2)
  const office = (await w.post(`${c}/senet/connections/${conn}/offices`, { senetOfficeId: 1, cashDeskId: 1, enabled: false, projectId: club })).office.id as number;
  await w.post(`${c}/senet/connections/${conn}/offices`, { senetOfficeId: 2, cashDeskId: 1, enabled: false });
  const res = await w.h.req('POST', `${c}/senet/connections/${conn}/sync`, { from: '2026-10-31T19:00:00.000Z', to: '2026-11-02T19:00:00.000Z' });
  expect(res.json().runs[0]).toMatchObject({ result: 'ok' });
  x = { w, fake, c, conn, club, office };
  return x;
}

const revenue = async (query: string) => {
  const res = await x!.w.h.req('GET', `${x!.c}/club-analytics/revenue?${query}`);
  expect(res.statusCode, res.body).toBe(200);
  return res.json();
};
const row = (r: { rows: { id: string }[] }, id: string) => r.rows.find((x) => x.id === id) as { id: string; label: string; values: (number | null)[]; total: number | null; prevTotal: number | null };

describe('лист Excel «Выручки клуба»', () => {
  const data = (rows: { label: string; values: (number | null)[]; total: number | null }[], columns: string[]) =>
    ({ columns: columns.map((label) => ({ key: label, from: '', to: '', label })), rows }) as unknown as Parameters<typeof revenueSheet>[0];
  const q = (by: 'parts' | 'cashiers' | 'shifts') => ({ from: '2026-11-01', to: '2026-11-02', step: 'day', by, view: 'table', compare: false }) as Parameters<typeof revenueSheet>[1];

  it('по частям — колонки шага и «Итого»; у кассиров вторая колонка — число смен; по сменам — без «Итого»', () => {
    const parts = revenueSheet(data([{ label: 'Часы', values: [100, null], total: 100 }], ['1 ноя', '2 ноя']), q('parts'));
    expect(parts.columns.map((c) => c.header)).toEqual(['Строка', '1 ноя', '2 ноя', 'Итого']);
    expect(parts.rows[0]).toEqual([{ kind: 'text', value: 'Часы' }, { kind: 'number', value: '1.00', decimals: 2 }, null, { kind: 'number', value: '1.00', decimals: 2 }]);
    expect(parts.preamble!.map((r) => (r[0] as { value: string }).value)).toContain('Шаг: по дням');
    const cashiers = revenueSheet(data([{ label: 'Сотрудник А', values: [300, 3, 100], total: null }], ['Выручка', 'Смен', 'В среднем за смену']), q('cashiers'));
    expect(cashiers.columns.map((c) => c.header)).toEqual(['Строка', 'Выручка', 'Смен', 'В среднем за смену']);
    expect(cashiers.rows[0]![2]).toEqual({ kind: 'number', value: '3', decimals: 0 });
    const shifts = revenueSheet(data([{ label: 'Смена', values: [1, 2, 3, 4, 5, 6], total: null }], ['a', 'b', 'c', 'd', 'e', 'f']), q('shifts'));
    expect(shifts.columns).toHaveLength(7);
    expect(shifts.preamble!.map((r) => (r[0] as { value: string }).value).some((l) => l.startsWith('Шаг'))).toBe(false);
  });
});

describe('«Выручка клуба»', () => {
  it('по частям за 01–02.11 по дням: часы, бар, выручка, справочные строки; покрытие; деньги в кассу сходятся со сменами', async () => {
    await setup();
    const r = await revenue('from=2026-11-01&to=2026-11-02&step=day&compare=0');
    expect(r.rows.map((x: { id: string; label: string }) => [x.id, x.label])).toEqual([
      ['hours', 'Часы'],
      ['bar', 'Бар'],
      ['revenue', 'Выручка'],
      ['refills', 'Справочно: пополнения балансов'],
      ['desk', 'Справочно: деньги в кассу'],
      ['diff', 'Справочно: разница'],
    ]);
    expect(row(r, 'hours').values).toEqual([T(1_500), T(400)]);
    expect(row(r, 'bar').values).toEqual([T(1_500), T(750)]);
    expect(row(r, 'revenue')).toMatchObject({ values: [T(3_000), T(1_150)], total: T(4_150) });
    expect(row(r, 'refills').values).toEqual([T(500), 0]);
    expect(row(r, 'desk').values).toEqual([T(3_000), T(1_500)]);
    expect(row(r, 'diff').values).toEqual([0, T(350)]);
    expect(r.coverage).toMatchObject({ days: 2, withData: 2, partial: 0, missingDays: [] });
    expect(r.reconcile).toMatchObject({ shifts: 3, desk: T(4_500), diffShifts: [] });
    expect(r.meta).toMatchObject({ from: '2026-11-01', to: '2026-11-02', step: 'day', by: 'parts', empty: false });
    expect(r.columns.map((c: { key: string }) => c.key)).toEqual(['2026-11-01', '2026-11-02']);
  });

  it('транзакция ночной смены больше её выручки — смена в «Не сходится со сменами»', async () => {
    await setup({ ...DATA, tx: [...DATA.tx, tx('2026-11-02 01:00:00', 50, 'Наличный расчет')] });
    const r = await revenue('from=2026-11-01&to=2026-11-02&step=day&compare=0');
    expect(r.reconcile.diffShifts).toEqual([{ id: expect.any(Number), openedAt: '2026-11-01T17:01:00.000Z', diff: T(50) }]);
  });

  it('дни без данных — null и в missingDays; прошлый период без данных — prevTotal null', async () => {
    await setup();
    const r = await revenue('from=2026-11-01&to=2026-11-05&step=day');
    expect(r.coverage.missingDays).toEqual(['2026-11-03', '2026-11-04', '2026-11-05']);
    expect(row(r, 'revenue').values.slice(2)).toEqual([null, null, null]);
    expect(row(r, 'revenue').prevTotal).toBeNull();
    expect(r.prevCoverage).toEqual({ days: 5, withData: 0 });
    const month = await revenue('from=2026-11-01&to=2026-11-30&step=month&compare=0');
    expect(month.coverage.columns).toEqual([{ withData: 2, total: 30 }]);
  });

  it('разрезы: по способу оплаты, по сменам, по кассирам; один клуб', async () => {
    const s = await setup();
    const pay = await revenue('from=2026-11-01&to=2026-11-02&step=day&by=payment&compare=0');
    expect(pay.rows.map((x: { label: string }) => x.label)).toEqual(['Наличный расчет', 'Безналичный расчет']);
    expect(pay.rows[0].values).toEqual([T(2_000), T(1_500)]);
    const shifts = await revenue('from=2026-11-01&to=2026-11-02&by=shifts&compare=0');
    expect(shifts.columns.map((c: { key: string }) => c.key)).toEqual(['revenue', 'bar', 'desk', 'refills', 'outs', 'cashAfter']);
    expect(shifts.rows.map((x: { label: string }) => x.label)).toEqual(['01.11 10:00 — 22:00 · Сотрудник А', '01.11 22:01 — 02.11 10:00 · Сотрудник А', '02.11 10:01 — 22:00 · Сотрудник А']);
    expect(shifts.rows[2].values).toEqual([T(1_150), T(750), T(1_500), 0, T(500), T(5_000)]);
    expect(shifts.rows[0].id).toMatch(/^shift:\d+$/);
    const cashiers = await revenue('from=2026-11-01&to=2026-11-02&by=cashiers&compare=0');
    expect(cashiers.columns.map((c: { key: string }) => c.key)).toEqual(['revenue', 'shifts', 'perShift']);
    expect(cashiers.rows).toEqual([expect.objectContaining({ label: 'Сотрудник А', values: [T(4_150), 3, Math.round(T(4_150) / 3)] })]);
    const one = await revenue(`from=2026-11-01&to=2026-11-02&step=day&compare=0&project=${s.club}`);
    expect(row(one, 'revenue').total).toBe(T(4_150));
  });

  it('карта по часам; строки ячейки — без хеша телефона; Excel; ошибки', async () => {
    await setup();
    const map = await revenue('from=2026-11-01&to=2026-11-02&view=hours&compare=0');
    expect(map.heatmap).toHaveLength(7);
    // 01.11 — воскресенье (6): сеанс 20:00–21:30 (900 ₸) — 600 ₸ в 20 ч
    expect(map.heatmap[6][20]).toBe(T(600));
    const cell = await x!.w.h.req('GET', `${x!.c}/club-analytics/revenue/rows?from=2026-11-01&to=2026-11-02&step=day&row=hours&col=2026-11-01`);
    expect(cell.statusCode).toBe(200);
    const items = cell.json().items as { kind: string; amount: number; phoneMask: string | null }[];
    expect(items.map((i) => [i.kind, i.amount])).toEqual([
      ['session', T(900)],
      ['session', T(600)],
    ]);
    expect(items[0]!.phoneMask).toBe('+7 *** ** 12');
    const hashes = (await x!.w.h.t.q('SELECT phone_hash h FROM senet_load WHERE phone_hash IS NOT NULL')).map((r) => String(r.h));
    expect(hashes.length).toBeGreaterThan(0);
    for (const h of hashes) expect(cell.body).not.toContain(h);
    const cellOf = async (q: string) => (await x!.w.h.req('GET', `${x!.c}/club-analytics/revenue/rows?from=2026-11-01&to=2026-11-02&step=day&${q}`)).json();
    expect((await cellOf('row=bar&col=2026-11-01')).items.map((i: { kind: string; label: string; amount: number }) => [i.kind, i.label, i.amount])).toEqual([['sale', 'Напиток 1', T(1_500)]]);
    expect((await cellOf('row=revenue&col=total')).items.map((i: { kind: string }) => i.kind)).toEqual(['sale', 'session', 'session', 'session', 'sale']);
    expect((await cellOf('row=refills&col=total')).items.map((i: { amount: number }) => i.amount)).toEqual([T(500)]);
    expect((await cellOf('row=desk&col=2026-11-02')).items.map((i: { label: string; amount: number }) => [i.label, i.amount])).toEqual([['Наличный расчет', T(1_500)]]);
    expect(await cellOf('row=desk&col=2026-12-01')).toEqual({ items: [], nextCursor: null });
    expect((await cellOf('row=desk&col=total&cursor=2')).items).toHaveLength(1);
    const xlsx = await x!.w.h.req('GET', `${x!.c}/club-analytics/revenue.xlsx?from=2026-11-01&to=2026-11-02&step=day&compare=0`);
    expect(xlsx.statusCode).toBe(200);
    expect(xlsx.headers['content-type']).toContain('spreadsheetml');
    expect((await x!.w.h.req('GET', `${x!.c}/club-analytics/revenue?from=2026-11-01&to=2026-11-02&project=999999`)).statusCode).toBe(404);
    const long = await x!.w.h.req('GET', `${x!.c}/club-analytics/revenue?from=2025-01-01&to=2026-11-02&step=day`);
    expect(long.statusCode).toBe(400);
    expect(long.json().error.fields.step).toBe('Слишком много колонок — выберите больший шаг');
  });
});
