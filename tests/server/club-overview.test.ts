import { afterEach, describe, expect, it } from 'vitest';
import { approxOf, bestWorst, visibleTileDefs } from '../../src/server/modules/club-analytics/overview';
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
  return res.json() as Promise<{ tiles: Tile[]; days: { day: string; revenue: number | null; coverage: string }[]; best: { day: string; revenue: number }[]; worst: { day: string; revenue: number }[]; coverage: { withData: number }; prevCoverage: unknown; freshness: string | null }>;
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
    expect(tile(r, 'load')).toMatchObject({ available: false, note: 'Появится с отчётом «Загрузка»', value: null, spark: [] });
    expect(tile(r, 'guests')).toMatchObject({ available: false, note: 'Появится с отчётом «Гости»' });
    expect(tile(r, 'newGuests').available).toBe(false);
    expect(tile(r, 'revenuePerGuest').available).toBe(false);
    expect(tile(r, 'barMargin')).toMatchObject({ available: false, note: 'Появится с отчётом «Бар»' });
    expect(r.days).toEqual([
      { day: '2026-11-01', revenue: T(3_750), coverage: 'full' },
      { day: '2026-11-02', revenue: T(2_650), coverage: 'full' },
    ]);
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
