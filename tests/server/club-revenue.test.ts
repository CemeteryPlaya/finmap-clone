import { afterEach, describe, expect, it } from 'vitest';
import { revenueSheet } from '../../src/server/modules/club-analytics/revenue';
import { CLUB_DATA as DATA, clubWorld, T, tx, type ClubWorld } from '../helpers/club-senet';

/** «Выручка клуба» — API (спецификация «Аналитика клуба», §5, §3.3–3.4; план АК-1, задача 5). Деньги образцов — тенге, ответа — тиыны. */
let x: ClubWorld | null = null;
afterEach(async () => {
  await x?.close();
  x = null;
});

async function setup(data = DATA) {
  x = await clubWorld(data);
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
      ['packages', 'Абонементы'],
      ['rent', 'Аренда ПК'],
      ['hours', 'Часы'],
      ['bar', 'Бар'],
      ['revenue', 'Выручка'],
      ['refills', 'Справочно: пополнения балансов'],
      ['desk', 'Справочно: деньги в кассу'],
      ['diff', 'Справочно: разница'],
    ]);
    expect(row(r, 'packages').values).toEqual([T(750), T(1_500)]);
    expect(row(r, 'rent').values).toEqual([T(1_500), T(400)]);
    expect(row(r, 'hours').values).toEqual([T(2_250), T(1_900)]);
    expect(row(r, 'bar').values).toEqual([T(1_500), T(750)]);
    expect(row(r, 'revenue')).toMatchObject({ values: [T(3_750), T(2_650)], total: T(6_400) });
    expect(row(r, 'refills').values).toEqual([T(500), T(1_000)]);
    expect(row(r, 'desk').values).toEqual([T(3_000), T(1_500)]);
    expect(row(r, 'diff').values).toEqual([T(-750), T(-1_150)]);
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
    // R43: период идёт («сейчас» мира — 03.11) — прошлый обрезан к тому же дню: 27–29.10
    expect(r.prevCoverage).toEqual({ days: 3, withData: 0 });
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
    expect(shifts.rows[2].values).toEqual([T(2_650), T(750), T(1_500), T(1_000), T(500), T(5_000)]);
    expect(shifts.rows[0].values.slice(0, 4)).toEqual([T(3_150), T(1_500), T(2_000), T(500)]);
    expect(shifts.rows[0].id).toMatch(/^shift:\d+$/);
    // день открытия смены в поясе приложения — для ссылки на смену в «Сверке»
    expect(shifts.rows.map((x: { day?: string }) => x.day)).toEqual(['2026-11-01', '2026-11-01', '2026-11-02']);
    const cashiers = await revenue('from=2026-11-01&to=2026-11-02&by=cashiers&compare=0');
    expect(cashiers.columns.map((c: { key: string }) => c.key)).toEqual(['revenue', 'shifts', 'perShift']);
    expect(cashiers.rows).toEqual([expect.objectContaining({ label: 'Сотрудник А', values: [T(6_400), 3, Math.round(T(6_400) / 3)] })]);
    const one = await revenue(`from=2026-11-01&to=2026-11-02&step=day&compare=0&project=${s.club}`);
    expect(row(one, 'revenue').total).toBe(T(6_400));
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
    // row=hours за 01.11: абонемент 15:00 и два сеанса
    expect(items.map((i) => [i.kind, i.amount])).toEqual([
      ['package', T(750)],
      ['session', T(900)],
      ['session', T(600)],
    ]);
    expect(items[0]!.phoneMask).toBe('+7 *** ** 12');
    const hashes = (await x!.w.h.t.q('SELECT phone_hash h FROM senet_load WHERE phone_hash IS NOT NULL UNION SELECT phone_hash h FROM senet_tickets WHERE phone_hash IS NOT NULL')).map((r) => String(r.h));
    expect(hashes.length).toBeGreaterThan(0);
    for (const h of hashes) expect(cell.body).not.toContain(h);
    const cellOf = async (q: string) => (await x!.w.h.req('GET', `${x!.c}/club-analytics/revenue/rows?from=2026-11-01&to=2026-11-02&step=day&${q}`)).json();
    expect((await cellOf('row=bar&col=2026-11-01')).items.map((i: { kind: string; label: string; amount: number }) => [i.kind, i.label, i.amount])).toEqual([['sale', 'Напиток 1', T(1_500)]]);
    expect((await cellOf('row=revenue&col=total')).items.map((i: { kind: string }) => i.kind)).toEqual(['sale', 'package', 'session', 'session', 'session', 'sale', 'package']);
    expect((await cellOf('row=packages&col=total')).items.map((i: { label: string; amount: number; phoneMask: string | null }) => [i.label, i.amount, i.phoneMask])).toEqual([
      ['2+1 Standart', T(750), '+7 *** ** 12'],
      ['3+2', T(1_500), '+7 *** ** 12'],
    ]);
    expect((await cellOf('row=hours&col=2026-11-02')).items.map((i: { kind: string }) => i.kind)).toEqual(['session', 'package']);
    expect((await cellOf('row=refills&col=total')).items.map((i: { amount: number }) => i.amount)).toEqual([T(500), T(1_000)]);
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
