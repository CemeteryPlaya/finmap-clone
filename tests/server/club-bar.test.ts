import { afterEach, describe, expect, it } from 'vitest';
import { barSheets } from '../../src/server/modules/club-analytics/bar';
import { barQuerySchema } from '../../src/shared/schemas/club-analytics';
import { clubWorld, T, type ClubWorld } from '../helpers/club-senet';

/**
 * Отчёт «Бар» (спецификация «Аналитика клуба», §8, R32–R41; план АК-4, задача 3). Продажи — фикстура `CLUB_DATA.sold`
 * («Напиток 1»: 01.11 — 2 шт за 1 500 ₸, 02.11 — 1 шт за 750 ₸); окна движения и остатков вставляются SQL.
 */
let x: ClubWorld | null = null;
afterEach(async () => {
  await x?.close();
  x = null;
});

/** Местные сутки Алматы (UTC+5) → окно UTC. */
const day = (d: string) => {
  const from = new Date(`${d}T00:00:00+05:00`);
  return [from.toISOString(), new Date(from.getTime() + 86_400_000).toISOString()] as const;
};

async function move(office: number, win: readonly [string, string], item: string, o: { category?: string; soldQty?: number; soldCost?: number | null; writeOff?: number; restockSum?: number } = {}) {
  await x!.w.h.t.q(
    'INSERT INTO senet_goods_moves (office_id, from_at, to_at, category, item, sold_qty, sold_cost, write_off_qty, restock_sum) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
    office,
    win[0],
    win[1],
    o.category ?? 'Напитки',
    item,
    o.soldQty ?? 0,
    o.soldCost ?? null,
    o.writeOff ?? 0,
    o.restockSum ?? 0,
  );
}

const stock = (office: number, win: readonly [string, string], item: string, actual: number) =>
  x!.w.h.t.q('INSERT INTO senet_stock (office_id, from_at, to_at, item, actual_qty) VALUES (?, ?, ?, ?, ?)', office, win[0], win[1], item, actual);

const sale = (office: number, at: string, item: string, qty: number, amount: number) =>
  x!.w.h.t.q('INSERT INTO senet_sold_items (office_id, at, item, qty, amount) VALUES (?, ?, ?, ?, ?)', office, at, item, qty, amount);

/** Движение 01.11 и 02.11 «Напитка 1»: себестоимость 380 ₸ за 1 шт, списание 1 шт 01.11, приход 800 ₸. */
async function seedMoves(office: number) {
  await move(office, day('2026-11-01'), 'Напиток 1', { soldQty: 2000, soldCost: T(760), writeOff: 1000, restockSum: T(800) });
  await move(office, day('2026-11-02'), 'Напиток 1', { soldQty: 1000, soldCost: T(380) });
}

const report = async (q: string) => {
  const res = await x!.w.h.req('GET', `${x!.c}/club-analytics/bar?${q}`);
  expect(res.statusCode, res.body).toBe(200);
  return res.json();
};
const row = (r: { rows: { key: string }[] }, key: string) => r.rows.find((v) => v.key === key) as Record<string, unknown> | undefined;
const tile = (r: { tiles: { key: string }[] }, key: string) => r.tiles.find((v) => v.key === key) as Record<string, unknown> | undefined;
const PERIOD = 'from=2026-11-01&to=2026-11-02&compare=0';

describe('отчёт «Бар»', () => {
  it('товар: продано и выручка — из продаж (как «Бар» в «Выручке»), себестоимость — из движения; чек времени не товар', async () => {
    x = await clubWorld();
    await seedMoves(x.office);
    const r = await report(PERIOD);
    const drink = row(r, 'Напиток 1')!;
    expect(drink).toMatchObject({ category: 'Напитки', soldQty: 3000, revenue: T(2250), cost: T(1140), profit: T(1110), writeOffQty: 1000 });
    expect(drink.margin).toBeCloseTo(1110 / 2250);
    expect(row(r, 'A1B2')).toBeUndefined();
    const rev = (await x.w.h.req('GET', `${x.c}/club-analytics/revenue?${PERIOD}`)).json();
    expect(rev.rows.find((v: { id: string }) => v.id === 'bar').total).toBe(T(2250));
    expect(r.series.map((s: { id: string }) => s.id)).toEqual(['cost', 'profit', 'noCost']);
  });

  it('старое перекрытое окно не удваивает списания (Review Focus 1)', async () => {
    x = await clubWorld();
    await seedMoves(x.office);
    await move(x.office, ['2026-11-01T03:05:00.000Z', '2026-11-02T03:05:00.000Z'], 'Напиток 1', { writeOff: 5000, restockSum: T(9000) });
    const r = await report(PERIOD);
    expect(row(r, 'Напиток 1')).toMatchObject({ writeOffQty: 1000 });
    expect(r.purchases.restock).toBe(T(800));
  });

  it('новый товар без движения: «Без категории», нет себестоимости, noCost (Review Focus 3)', async () => {
    x = await clubWorld();
    await seedMoves(x.office);
    await sale(x.office, '2026-11-01T10:00:00.000Z', 'Товар 9', 1000, T(500));
    const r = await report(PERIOD);
    expect(row(r, 'Товар 9')).toMatchObject({ category: 'Без категории', cost: null, profit: null, margin: null });
    expect(r.noCost).toBe(1);
    const cats = await report(`${PERIOD}&by=categories`);
    expect(cats.rows.map((v: { key: string }) => v.key)).toEqual(['Напитки', 'Без категории']);
    expect(row(cats, 'Напитки')).toMatchObject({ stockQty: null, daysLeft: null });
  });

  it('остаток и «хватит на» — по дням с полными продажами; период из 3 дней — те же дни (Review Focus 4)', async () => {
    x = await clubWorld();
    await seedMoves(x.office);
    await stock(x.office, day('2026-11-01'), 'Напиток 1', 12_000);
    await stock(x.office, day('2026-11-02'), 'Напиток 1', 10_000);
    for (const q of [PERIOD, 'from=2026-11-01&to=2026-11-03&compare=0']) {
      const drink = row(await report(q), 'Напиток 1')!;
      expect(drink.stockQty).toBe(10_000);
      expect(drink.daysLeft).toBeCloseTo(10_000 / (3000 / 2));
    }
  });

  it('«Все клубы»: один товар двух клубов — одна строка, суммы; один клуб — его цифры (Review Focus 5)', async () => {
    x = await clubWorld();
    const club2 = (await x.w.post(`${x.c}/projects`, { name: 'Клуб 4', templateKey: 'computer-club', templateParams: { pcCount: 5 } })).project.id as number;
    await x.w.h.t.q('UPDATE senet_offices SET project_id = ? WHERE senet_office_id = 2', club2);
    const office2 = Number((await x.w.h.t.q('SELECT id FROM senet_offices WHERE senet_office_id = 2'))[0]!.id);
    await seedMoves(x.office);
    await stock(x.office, day('2026-11-02'), 'Напиток 1', 10_000);
    await sale(office2, '2026-11-02T10:00:00.000Z', 'Напиток 1', 1000, T(700));
    await stock(office2, day('2026-11-02'), 'Напиток 1', 5_000);
    // забор фикстуры кладёт те же продажи и во второй клуб: 3 шт за 2 250 ₸ в каждом, плюс 1 шт за 700 ₸ во втором
    expect(row(await report(PERIOD), 'Напиток 1')).toMatchObject({ soldQty: 7000, revenue: T(5200), stockQty: 15_000 });
    expect(row(await report(`${PERIOD}&project=${club2}`), 'Напиток 1')).toMatchObject({ soldQty: 4000, revenue: T(2950), stockQty: 5_000 });
  });

  it('закупки: из кассы, приход в Senet, разница', async () => {
    x = await clubWorld();
    await seedMoves(x.office);
    const shift = Number((await x.w.h.t.q('SELECT id FROM senet_shifts WHERE office_id = ? ORDER BY opened_at', x.office))[0]!.id);
    await x.w.h.t.q("INSERT INTO senet_cash_moves (shift_id, senet_ref, kind, amount, at, comment) VALUES (?, 'bar|1', 'out', ?, '2026-11-01T08:00:00.000Z', 'bar')", shift, T(1000));
    const moveId = Number((await x.w.h.t.q("SELECT id FROM senet_cash_moves WHERE senet_ref = 'bar|1'"))[0]!.id);
    await x.w.h.t.q('INSERT INTO senet_bar_purchases (cash_move_id, item_text, qty, price, amount) VALUES (?, ?, ?, ?, ?)', moveId, 'кола', 2000, T(500), T(1000));
    expect((await report(PERIOD)).purchases).toEqual({ desk: T(1000), restock: T(800), diff: T(200) });
  });

  it('плитки со сравнением; покрытие — продажи и движение', async () => {
    x = await clubWorld();
    await seedMoves(x.office);
    const r = await report('from=2026-11-02&to=2026-11-02&compare=1');
    expect(tile(r, 'barRevenue')).toMatchObject({ kind: 'sum', value: T(750), prev: T(1500) });
    expect(tile(r, 'barMargin')).toMatchObject({ kind: 'share', unit: 'percent' });
    expect(tile(r, 'barMargin')!.value).toBeCloseTo((750 - 380) / 750);
    const three = await report('from=2026-11-01&to=2026-11-03&compare=0');
    expect(three.coverage).toMatchObject({ days: 3, withData: 2 });
  });

  it('продажи товара под таблицей; Excel; ошибки', async () => {
    x = await clubWorld();
    await seedMoves(x.office);
    const rows = await x.w.h.req('GET', `${x.c}/club-analytics/bar/rows?${PERIOD}&item=${encodeURIComponent('Напиток 1')}`);
    expect(rows.statusCode, rows.body).toBe(200);
    expect(rows.json()).toMatchObject({ items: [{ kind: 'sale', label: 'Напиток 1', amount: T(1500) }, { kind: 'sale', amount: T(750) }], nextCursor: null });
    const xlsx = await x.w.h.req('GET', `${x.c}/club-analytics/bar.xlsx?${PERIOD}`);
    expect(xlsx.statusCode, xlsx.body).toBe(200);
    expect(xlsx.headers['content-type']).toContain('spreadsheetml');
    const q = barQuerySchema.parse({ from: '2026-11-01', to: '2026-11-02' });
    expect(barSheets(await report(PERIOD), q).map((s) => s.name)).toEqual(['Товары', 'По шагу', 'Закупки']);
    expect(barSheets(await report(`${PERIOD}&by=categories`), { ...q, by: 'categories' }).map((s) => s.name)).toEqual(['Категории', 'По шагу', 'Закупки']);
    expect((await x.w.h.req('GET', `${x.c}/club-analytics/bar?${PERIOD}&project=999999`)).statusCode).toBe(404);
    const bad = await x.w.h.req('GET', `${x.c}/club-analytics/bar?${PERIOD}&by=x`);
    expect(bad.statusCode).toBe(400);
    expect(bad.body).toContain('Разрез — items или categories');
  });
});
