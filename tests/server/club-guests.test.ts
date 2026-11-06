import { afterEach, describe, expect, it } from 'vitest';
import { guestsSheets } from '../../src/server/modules/club-analytics/guests';
import { guestsQuerySchema } from '../../src/shared/schemas/club-analytics';
import { CLUB_DATA, clubWorld, T, type ClubWorld } from '../helpers/club-senet';

/**
 * Отчёт «Гости» (спецификация «Аналитика клуба», §7, R17–R27; план АК-3, задачи 4–5). Строки Senet вставляются напрямую,
 * хеши телефонов — синтетические («hash-…»), их не должно быть ни в одном ответе.
 */
let x: ClubWorld | null = null;
afterEach(async () => {
  await x?.close();
  x = null;
});

const EMPTY = { ...CLUB_DATA, load: [], refills: [], tickets: [] };
/** Местное время Алматы → ISO UTC. */
const t = (local: string) => new Date(`${local}:00+05:00`).toISOString();

async function session(office: number, from: string, login: string, hash: string | null, opts: { minutes?: number; debited?: number; age?: number | null } = {}) {
  const start = t(from);
  const end = new Date(Date.parse(start) + (opts.minutes ?? 60) * 60_000).toISOString();
  await x!.w.h.t.q(
    'INSERT INTO senet_load (office_id, start_at, end_at, zone, workstation, guest_login, phone_hash, phone_mask, age, debited) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
    office,
    start,
    end,
    'VIP',
    1,
    login,
    hash,
    hash ? `+7 *** ** ${hash.slice(-2)}` : null,
    opts.age ?? null,
    opts.debited ?? 0,
  );
}

/** Отчёт `load` покрывает местные дни `[from, to)`. */
const span = (office: number, from: string, to: string) =>
  x!.w.h.t.q('INSERT INTO senet_data_spans (office_id, report, from_at, to_at) VALUES (?, ?, ?, ?)', office, 'load', t(`${from}T00:00`), t(`${to}T00:00`));

const report = async (q: string) => {
  const res = await x!.w.h.req('GET', `${x!.c}/club-analytics/guests?${q}`);
  expect(res.statusCode, res.body).toBe(200);
  return res.json();
};
const tile = (r: { tiles: { key: string }[] }, key: string) => r.tiles.find((v) => v.key === key) as { value: number | null; prev: number | null } | undefined;

/** Гости: a+b (общий телефон), c (20.10 и 03.11), d (04.11), f (28.10), общий логин guest с 4 телефонами. */
async function seed() {
  const o = x!.office;
  await span(o, '2026-10-01', '2026-11-08');
  await session(o, '2026-11-02T18:00', 'a', 'hash-ab-11', { age: 19 });
  await session(o, '2026-11-05T18:00', 'b', 'hash-ab-11');
  await session(o, '2026-10-20T18:00', 'c', 'hash-c-22');
  await session(o, '2026-11-03T18:00', 'c', 'hash-c-22');
  await session(o, '2026-11-04T18:00', 'd', null, { age: 30 });
  await session(o, '2026-10-28T18:00', 'f', null);
  for (const h of ['hash-g-31', 'hash-g-32', 'hash-g-33', 'hash-g-34']) await session(o, '2026-11-06T12:00', 'guest', h);
  await session(o, '2026-11-06T14:00', 'guest', null);
  await session(o, '2026-11-06T15:00', '', null);
}

describe('отчёт «Гости»', () => {
  it('гости, новые и вернувшиеся, ряд, общие логины, без гостя, Δ, полоса первых дней', async () => {
    x = await clubWorld(EMPTY);
    await seed();
    const r = await report('from=2026-11-02&to=2026-11-08&step=day&compare=1');
    // a+b — один гость; c вернулся; d новый; 4 телефона общего логина — 4 гостя
    expect(tile(r, 'guests')).toMatchObject({ value: 7, prev: 1 });
    expect(tile(r, 'returning')!.value).toBe(1);
    expect(tile(r, 'newGuests')!.value).toBe(6);
    expect(r.top.find((g: { logins: string[] }) => g.logins.includes('a')).logins).toEqual(['a', 'b']);
    expect(r.unassigned).toEqual({ noGuest: 1, shared: 1 });
    const col = (id: string, day: string) => r.series.find((s: { id: string }) => s.id === id).values[r.columns.findIndex((c: { from: string }) => c.from === day)];
    expect(col('new', '2026-11-04')).toBe(1);
    expect(col('returning', '2026-11-03')).toBe(1);
    expect(col('new', '2026-11-08')).toBeNull();
    expect(r.firstDaysNote).toBe('Данные Senet начинаются 20.10.2026 — гости этих дней считаются новыми');
    expect(r.ages.find((a: { label: string }) => a.label === '18–24').count).toBe(1);
    expect((await report('from=2026-12-01&to=2026-12-07&step=day')).firstDaysNote).toBeNull();
  });

  it('когорты: строки — месяцы периода, будущие месяцы пусты', async () => {
    x = await clubWorld(EMPTY);
    await seed();
    const r = await report('from=2026-10-01&to=2026-11-30&step=month&compare=0');
    expect(r.cohorts[0]).toEqual({ month: '2026-10', size: 2, shares: [1, 0.5, null, null, null, null, null] });
    expect(r.cohorts[1].month).toBe('2026-11');
  });

  it('«Все клубы» и один клуб: гость один и тот же', async () => {
    x = await clubWorld(EMPTY);
    const club2 = (await x.w.post(`${x.c}/projects`, { name: 'Клуб 4', templateKey: 'computer-club', templateParams: { pcCount: 5 } })).project.id as number;
    await x.w.h.t.q('UPDATE senet_offices SET project_id = ? WHERE senet_office_id = 2', club2);
    const office2 = Number((await x.w.h.t.q('SELECT id FROM senet_offices WHERE senet_office_id = 2'))[0]!.id);
    await span(x.office, '2026-11-01', '2026-11-08');
    await span(office2, '2026-11-01', '2026-11-08');
    await session(x.office, '2026-11-02T18:00', 'a', 'hash-a-11');
    await session(office2, '2026-11-03T18:00', 'A', 'hash-a-11');
    expect(tile(await report('from=2026-11-02&to=2026-11-08&compare=0'), 'guests')!.value).toBe(1);
    const one = await report(`from=2026-11-02&to=2026-11-08&compare=0&project=${club2}`);
    expect(tile(one, 'guests')!.value).toBe(1);
    expect(one.top[0].logins).toEqual(['a', 'A']);
  });

  it('потрачено — абонементы и списано за сеансы; пополнено; выручка на гостя — выручка / гостей', async () => {
    x = await clubWorld();
    const q = 'from=2026-11-01&to=2026-11-02&compare=0';
    const r = await report(q);
    // гость1 и гость2 — общий телефон фикстуры: один гость
    expect(r.top).toHaveLength(1);
    expect(r.top[0]).toMatchObject({ logins: ['гость1', 'гость2'], spent: T(750 + 1_500 + 900 + 600 + 400), refilled: T(500 + 1_000), visits: 3 });
    const overview = (await x.w.h.req('GET', `${x.c}/club-analytics/overview?${q}`)).json();
    const revenue = overview.tiles.find((v: { key: string }) => v.key === 'revenue').value as number;
    expect(revenue).toBeGreaterThan(0);
    expect(tile(r, 'revenuePerGuest')!.value).toBe(revenue);
    expect(tile(r, 'refillsPerGuest')!.value).toBe(T(1_500));
  });

  it('хешей телефонов нет ни в ответе, ни в Excel; Excel скачивается', async () => {
    x = await clubWorld(EMPTY);
    await seed();
    const q = 'from=2026-10-01&to=2026-11-08&step=week&compare=1';
    const r = await report(q);
    expect(JSON.stringify(r)).not.toMatch(/hash-/);
    const sheets = guestsSheets(r, guestsQuerySchema.parse(Object.fromEntries(new URLSearchParams(q))), 'Asia/Almaty');
    expect(sheets.map((s) => s.name)).toEqual(['Постоянные гости', 'Когорты']);
    expect(JSON.stringify(sheets)).not.toMatch(/hash-/);
    const file = await x.w.h.req('GET', `${x.c}/club-analytics/guests.xlsx?${q}`);
    expect(file.statusCode, file.body).toBe(200);
  });
});
