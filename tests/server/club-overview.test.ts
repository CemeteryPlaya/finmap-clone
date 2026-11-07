import { afterEach, describe, expect, it } from 'vitest';
import { approxOf, bestWorst, overviewSheets, visibleTileDefs } from '../../src/server/modules/club-analytics/overview';
import { pcsOf } from '../../src/server/modules/club-analytics/scope';
import { CLUB_TILES } from '../../src/shared/analytics-catalog';
import { clubWorld, T, type ClubWorld } from '../helpers/club-senet';

/**
 * «Обзор клуба» — API (спецификация «Аналитика клуба», §4; план АК-1, задача 9). Данные — забор 01–02.11 из club-senet:
 * выручка 3 750 и 2 650 ₸, часы 2 250 и 1 900 ₸, бар 1 500 и 750 ₸, пополнения 500 и 1 000 ₸.
 */
let x: ClubWorld | null = null;
afterEach(async () => {
  await x?.close();
  x = null;
});

interface Tile {
  key: string;
  label: string;
  unit: string;
  kind: string;
  value: number | null;
  prev: number | null;
  approx: boolean;
  spark: (number | null)[];
  available: boolean;
  note: string | null;
  href: string;
}

const overview = async (query: string) => {
  const res = await x!.w.h.req('GET', `${x!.c}/club-analytics/overview?${query}`);
  expect(res.statusCode, res.body).toBe(200);
  return res.json() as Promise<{ peak: { weekday: number; hour: number; value: number }[]; tiles: Tile[]; days: { day: string; revenue: number | null; load: number | null; coverage: string }[]; best: { day: string; revenue: number }[]; worst: { day: string; revenue: number }[]; coverage: { withData: number }; prevCoverage: unknown; freshness: string | null }>;
};
const tile = (r: { tiles: Tile[] }, key: string) => r.tiles.find((t) => t.key === key)!;

/** Включить плитки «Обзора» настройкой компании (§10.2). */
async function showTiles(keys: string[]) {
  const s = (await x!.w.h.req('GET', `${x!.c}/analytics-settings`)).json();
  const items = s.tiles['computer-club'].items.map((i: { key: string; visible: boolean }) => ({ ...i, visible: i.visible || keys.includes(i.key) }));
  const res = await x!.w.h.req('PUT', `${x!.c}/analytics-settings/tiles.computer-club`, { items });
  expect(res.statusCode, res.body).toBe(200);
}

const categoryByRef = async (ref: string) => Number((await x!.w.h.t.q(`SELECT id FROM categories WHERE template_ref = '${ref}'`))[0]!.id);
const expense = (categoryId: number, projectId: number, tenge: number, accrualDate?: string) =>
  x!.w.post(x!.w.ops, { type: 'expense', accountId: x!.w.kzt, paidAt: '2026-11-01T06:00:00Z', accrualDate, amount: T(tenge), lines: [{ categoryId, projectId, amount: T(tenge) }] });

describe('лучшие и худшие дни', () => {
  const d = (day: string, revenue: number | null, coverage: 'full' | 'partial' | 'none' = 'full') => ({ day: `2026-11-0${day}`, revenue, coverage });

  it('по 3 дня; равные суммы — раньше идёт более ранний день; неполные и пустые дни не входят', () => {
    const days = [d('1', 500), d('2', 900), d('3', 100), d('4', 900), d('5', 300), d('6', 100), d('7', 700), d('8', 5_000, 'partial'), d('9', null, 'none')];
    expect(bestWorst(days)).toEqual({
      best: [d('2', 900), d('4', 900), d('7', 700)].map(({ day, revenue }) => ({ day, revenue })),
      worst: [d('3', 100), d('6', 100), d('5', 300)].map(({ day, revenue }) => ({ day, revenue })),
    });
  });

  it('полных дней меньше шести — списки не пересекаются, сначала лучшие', () => {
    expect(bestWorst([d('1', 100), d('2', 300), d('3', 200), d('4', 50)])).toEqual({
      best: [{ day: '2026-11-02', revenue: 300 }, { day: '2026-11-03', revenue: 200 }, { day: '2026-11-01', revenue: 100 }],
      worst: [{ day: '2026-11-04', revenue: 50 }],
    });
    expect(bestWorst([])).toEqual({ best: [], worst: [] });
  });
});

describe('visibleTileDefs', () => {
  it('без настройки — восемь плиток по умолчанию; с настройкой — видимые в её порядке', () => {
    expect(visibleTileDefs(undefined).map((t) => t.label)).toHaveLength(8);
    expect(visibleTileDefs({ items: [{ key: 'refills', visible: true }, { key: 'revenue', visible: true }, { key: 'load', visible: false }] }).map((t) => t.label)).toEqual(['Пополнения балансов', 'Выручка']);
  });
});

describe('pcsOf', () => {
  const scope = (projects: { id: number; pcCount: number | null }[], officeProjects: number[]) =>
    ({ projects: projects.map((p) => ({ ...p, name: '', archived: false })), offices: officeProjects.map((projectId, i) => ({ id: i + 1, projectId, connectionId: 1, lastSyncAt: null })), connected: true, freshness: null }) as Parameters<typeof pcsOf>[0];
  it('сумма ПК клубов с клубом Senet; клуб без Senet не считается; у клуба с Senet не задано — 0 (плитка недоступна)', () => {
    expect(pcsOf(scope([{ id: 1, pcCount: 40 }, { id: 2, pcCount: 25 }], [1, 2]))).toBe(65);
    expect(pcsOf(scope([{ id: 1, pcCount: 40 }, { id: 2, pcCount: null }], [1]))).toBe(40);
    // часы второго клуба вошли бы в числитель без его ПК в знаменателе — цифра завышена
    expect(pcsOf(scope([{ id: 1, pcCount: 40 }, { id: 2, pcCount: null }], [1, 2]))).toBe(0);
  });
});

describe('Excel «Обзора»', () => {
  it('без сравнения — без колонки прошлого периода; пустой день и загрузка — пустые ячейки, недоступная плитка — пометкой', () => {
    const data = {
      tiles: [
        { key: 'load', label: 'Загрузка ПК', unit: 'percent', kind: 'share', value: 0.425, prev: null, approx: false, spark: [], available: true, note: null, href: 'club/load' },
        { key: 'guests', label: 'Гостей', unit: 'number', kind: 'sum', value: null, prev: null, approx: false, spark: [], available: false, note: 'Появится с отчётом «Гости»', href: '' },
      ],
      days: [{ day: '2026-11-01', revenue: null, load: null, coverage: 'none' }],
    } as unknown as Parameters<typeof overviewSheets>[0];
    const [tiles, days] = overviewSheets(data, { from: '2026-11-01', to: '2026-11-01', compare: false } as Parameters<typeof overviewSheets>[1]);
    expect(tiles!.columns.map((c) => c.header)).toEqual(['Плитка', 'За период']);
    expect(tiles!.rows).toEqual([
      [{ kind: 'text', value: 'Загрузка ПК, %' }, { kind: 'number', value: '42.50', decimals: 2 }],
      [{ kind: 'text', value: 'Гостей' }, { kind: 'text', value: 'Появится с отчётом «Гости»' }],
    ]);
    expect(days!.columns.map((c) => c.header)).toEqual(['День', 'Выручка', 'Загрузка, %', 'Данные']);
    expect(days!.rows[0]!.slice(1)).toEqual([null, null, { kind: 'text', value: 'нет данных' }]);
  });
});

describe('approxOf', () => {
  const cov = (days: number, withData: number, missingDays: string[] = []) => ({ days, withData, partial: 0, missingDays });
  it('«≈»: прошедший день без данных или неполный прошлый период; будущие дни без данных не в счёт', () => {
    expect(approxOf(cov(3, 2, ['2026-11-03']), null, '2026-11-02')).toBe(false);
    expect(approxOf(cov(3, 2, ['2026-11-02']), null, '2026-11-02')).toBe(true);
    expect(approxOf(cov(3, 3), cov(3, 2), '2026-11-02')).toBe(true);
    expect(approxOf(cov(3, 3), cov(3, 3), '2026-11-02')).toBe(false);
  });
});

describe('«Обзор клуба»', () => {
  it('плитки по умолчанию — в порядке каталога; построенные считаются, плитки будущих отчётов — с пометкой', async () => {
    x = await clubWorld();
    const r = await overview('from=2026-11-01&to=2026-11-02&compare=0');
    expect(r.tiles.map((t) => t.key)).toEqual(['revenue', 'load', 'guests', 'newGuests', 'revenuePerGuest', 'revenuePerPcDay', 'barShare', 'barMargin']);
    expect(tile(r, 'revenue')).toMatchObject({ label: 'Выручка', unit: 'money', kind: 'sum', value: T(6_400), prev: null, available: true, note: null, spark: [T(3_750), T(2_650)], href: 'club/revenue' });
    expect(tile(r, 'barShare')).toMatchObject({ kind: 'share', value: 2_250 / 6_400, available: true });
    // загрузка: 01.11 — VIP 5 400 с + «Общий» 1 800 с, 02.11 — «Общий» 3 600 + 3 600 с; 10 ПК
    const day = 7_200 / (10 * 86_400);
    expect(tile(r, 'load')).toMatchObject({ unit: 'percent', kind: 'share', available: true, note: null, prev: null, href: 'club/load' });
    expect(tile(r, 'load').value).toBeCloseTo(day, 12);
    expect(tile(r, 'load').spark).toEqual([expect.closeTo(day, 12), expect.closeTo(day, 12)]);
    expect(r.peak).toHaveLength(3);
    // три часа по 0,1: пн 00:00 и 14:00 («Общий»), вс 20:00 (VIP); равные — раньше день недели, затем час
    expect(r.peak.map((c) => [c.weekday, c.hour])).toEqual([[0, 0], [0, 14], [6, 20]]);
    // гость1 и гость2 — общий телефон фикстуры: один гость; 01.11 — первый визит, 02.11 — вернулся
    expect(tile(r, 'guests')).toMatchObject({ unit: 'number', kind: 'sum', value: 1, spark: [1, 1], available: true, note: null, href: 'club/guests' });
    expect(tile(r, 'newGuests')).toMatchObject({ value: 1, spark: [1, 0], available: true });
    expect(tile(r, 'revenuePerGuest')).toMatchObject({ kind: 'avg', value: T(6_400), spark: [T(3_750), T(2_650)], available: true });
    // у товаров нет себестоимости — маржи нет, но плитка доступна (R40)
    expect(tile(r, 'barMargin')).toMatchObject({ unit: 'percent', kind: 'share', value: null, available: true, note: null, href: 'club/bar' });
    expect(r.tiles.some((t) => t.note === 'Появится с отчётом «Бар»')).toBe(false);
    expect(r.days).toEqual([
      { day: '2026-11-01', revenue: T(3_750), load: expect.closeTo(day, 12), coverage: 'full' },
      { day: '2026-11-02', revenue: T(2_650), load: expect.closeTo(day, 12), coverage: 'full' },
    ]);
  });

  it('«Маржа бара» (R40): прибыль / выручку товаров с себестоимостью; ряд по дням; прошлый период', async () => {
    x = await clubWorld();
    const win = (d: string) => {
      const from = new Date(`${d}T00:00:00+05:00`);
      return [from.toISOString(), new Date(from.getTime() + 86_400_000).toISOString()];
    };
    for (const [d, qty, cost] of [['2026-11-01', 2000, T(760)], ['2026-11-02', 1000, T(380)]] as const) {
      const [from, to] = win(d);
      await x.w.h.t.q('INSERT INTO senet_goods_moves (office_id, from_at, to_at, item, sold_qty, sold_cost) VALUES (?, ?, ?, ?, ?, ?)', x.office, from, to, 'Напиток 1', qty, cost);
    }
    const r = await overview('from=2026-11-01&to=2026-11-02&compare=0');
    expect(tile(r, 'barMargin')).toMatchObject({ available: true, href: 'club/bar' });
    expect(tile(r, 'barMargin').value).toBeCloseTo((2_250 - 1_140) / 2_250, 12);
    expect(tile(r, 'barMargin').spark).toEqual([expect.closeTo((1_500 - 760) / 1_500, 12), expect.closeTo((750 - 380) / 750, 12)]);
    const one = await overview('from=2026-11-02&to=2026-11-02&compare=1');
    expect(tile(one, 'barMargin').prev).toBeCloseTo((1_500 - 760) / 1_500, 12);
  });

  it('плитки гостей из каталога: визитов на гостя, длительность визита, доля вернувшихся', async () => {
    x = await clubWorld();
    await showTiles(['visitsPerGuest', 'visitDuration', 'returningShare']);
    const r = await overview('from=2026-11-01&to=2026-11-02&compare=0');
    // визиты: 01.11 20:00–21:30 и 23:30–01:00, 02.11 14:00–15:00
    expect(tile(r, 'visitsPerGuest')).toMatchObject({ kind: 'avg', value: 3, spark: [2, 1] });
    expect(tile(r, 'visitDuration')).toMatchObject({ kind: 'avg', unit: 'duration', value: (5_400 + 5_400 + 3_600) / 3 });
    expect(tile(r, 'returningShare')).toMatchObject({ kind: 'share', value: 0, spark: [0, 1] });
  });

  it('одноразовые чеки (R30, R31): «Посещений», «Одноразовых чеков», длительность — по всем посещениям, выручка на гостя — на гостей и чеки', async () => {
    x = await clubWorld();
    // чек Q9ZZ: 01.11 12:00–12:30 (Алматы, UTC+5)
    await x.w.h.t.q('INSERT INTO senet_refills (office_id, at, guest_login, account_type, amount) VALUES (?, ?, ?, ?, ?)', x.office, '2026-11-01T06:55:00.000Z', 'Q9ZZ', 'Check', T(300));
    await x.w.h.t.q(
      'INSERT INTO senet_load (office_id, start_at, end_at, zone, workstation, guest_login, debited) VALUES (?, ?, ?, ?, ?, ?, ?)',
      x.office,
      '2026-11-01T07:00:00.000Z',
      '2026-11-01T07:30:00.000Z',
      'VIP',
      1,
      'Q9ZZ',
      0,
    );
    await showTiles(['visitsAll', 'checks', 'visitDuration', 'guests', 'revenuePerGuest']);
    const r = await overview('from=2026-11-01&to=2026-11-02&compare=0');
    expect(tile(r, 'guests')).toMatchObject({ value: 1, spark: [1, 1] });
    expect(tile(r, 'checks')).toMatchObject({ kind: 'sum', value: 1, spark: [1, 0], available: true, href: 'club/guests' });
    expect(tile(r, 'visitsAll')).toMatchObject({ kind: 'sum', value: 4, spark: [3, 1] });
    expect(tile(r, 'visitDuration')!.value).toBe((5_400 + 5_400 + 3_600 + 1_800) / 4);
    expect(tile(r, 'revenuePerGuest')).toMatchObject({ value: T(6_400) / 2, spark: [T(3_750) / 2, T(2_650)] });
  });

  it('без видимых плиток гостей — только выбранные плитки', async () => {
    x = await clubWorld();
    const items = CLUB_TILES.map((t) => ({ key: t.key, visible: t.key === 'revenue' }));
    const res = await x.w.h.req('PUT', `${x.c}/analytics-settings/tiles.computer-club`, { items });
    expect(res.statusCode, res.body).toBe(200);
    expect((await overview('from=2026-11-01&to=2026-11-02&compare=0')).tiles.map((t) => t.key)).toEqual(['revenue']);
  });

  it('«Выручка на ПК в день» — выручка часов / (ПК × дней с данными); без количества ПК — пометка', async () => {
    x = await clubWorld();
    const r = await overview('from=2026-11-01&to=2026-11-02&compare=0');
    expect(tile(r, 'revenuePerPcDay')).toMatchObject({ kind: 'avg', value: T(4_150) / 20, spark: [T(2_250) / 10, T(1_900) / 10], available: true });
    await x.w.h.t.q(`UPDATE projects SET template_params = '{}' WHERE id = ${x.club}`);
    const none = await overview('from=2026-11-01&to=2026-11-02&compare=0');
    expect(tile(none, 'revenuePerPcDay')).toMatchObject({ available: false, value: null, note: 'Задайте количество ПК в карточке проекта' });
  });

  it('«ФОТ к выручке» и «Аренда к выручке» — расходы журнала проекта-клуба по дате сделки / выручку', async () => {
    x = await clubWorld();
    await showTiles(['payrollToRevenue', 'rentToRevenue', 'refills']);
    const admins = await categoryByRef('computer-club:salary-admins');
    await expense(admins, x.club, 1_000);
    await expense(admins, x.w.project, 5_000); // другой проект — не входит
    await expense(admins, x.club, 7_000, '2026-10-20'); // оплачен в периоде, сделка — раньше: не входит
    await expense(await categoryByRef('computer-club:rent'), x.club, 3_200);
    const r = await overview('from=2026-11-01&to=2026-11-02');
    expect(tile(r, 'payrollToRevenue')).toMatchObject({ kind: 'share', unit: 'percent', value: T(1_000) / T(6_400), prev: null, available: true, href: 'pnl' });
    expect(tile(r, 'rentToRevenue')).toMatchObject({ value: T(3_200) / T(6_400), available: true });
    expect(tile(await overview('from=2026-11-01&to=2026-11-02&compare=0'), 'payrollToRevenue')).toMatchObject({ value: T(1_000) / T(6_400), prev: null });
    expect(tile(r, 'refills')).toMatchObject({ kind: 'sum', value: T(1_500), spark: [T(500), T(1_000)] });
    // плитки — в порядке настройки: включённые идут на свои места каталога
    expect(r.tiles.map((t) => t.key).slice(-3)).toEqual(['refills', 'payrollToRevenue', 'rentToRevenue']);
  });

  it('лучшие и худшие дни — только полные; прошлый период без данных — prev null', async () => {
    x = await clubWorld();
    // 03.11 забран до 10:00 — день частичный
    const res = await x.w.h.req('POST', `${x.c}/senet/connections/${x.conn}/sync`, { from: '2026-11-02T19:00:00.000Z', to: '2026-11-03T05:00:00.000Z' });
    expect(res.json().runs[0]).toMatchObject({ result: 'ok' });
    const r = await overview('from=2026-11-01&to=2026-11-03');
    expect(r.days.map((d) => d.coverage)).toEqual(['full', 'full', 'partial']);
    expect(r.best).toEqual([
      { day: '2026-11-01', revenue: T(3_750) },
      { day: '2026-11-02', revenue: T(2_650) },
    ]);
    expect(r.worst).toEqual([]);
    expect(tile(r, 'revenue')).toMatchObject({ value: T(6_400), prev: null });
    expect(r.prevCoverage).toEqual({ days: 3, withData: 0 });
  });

  it('Excel — плитки и ряд по дням; чужой клуб — 404', async () => {
    x = await clubWorld();
    const xlsx = await x.w.h.req('GET', `${x.c}/club-analytics/overview.xlsx?from=2026-11-01&to=2026-11-02`);
    expect(xlsx.statusCode, xlsx.body).toBe(200);
    expect(xlsx.headers['content-type']).toContain('spreadsheetml');
    expect((await x.w.h.req('GET', `${x.c}/club-analytics/overview?from=2026-11-01&to=2026-11-02&project=999999`)).statusCode).toBe(404);
  });
});
