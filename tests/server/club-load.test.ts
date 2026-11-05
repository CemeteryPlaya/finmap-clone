import { afterEach, describe, expect, it } from 'vitest';
import { buildLoadReport, periodZones, type ClubLoadData } from '../../src/server/modules/club-analytics/load';
import { CLUB_DATA, clubWorld, type ClubWorld } from '../helpers/club-senet';
import { xlTime, type SampleValue } from '../helpers/senet-samples';

/**
 * «Загрузка» — API (спецификация «Аналитика клуба», §6, §13, R9–R15; план АК-2, задача 3). Клуб: «Количество ПК» 10.
 * Сеансы фикстуры: «VIP» 7 — 01.11 20:00–21:30; «Общий» 3 — 01.11 23:30–02.11 01:00 и 02.11 14:00–15:00. Тест добавляет
 * сеанс без конца и «Общий» 5 — 31.10 23:00–01.11 01:00 (через начало периода).
 */
let x: ClubWorld | null = null;
afterEach(async () => {
  await x?.close();
  x = null;
});

const load = (open: string, close: string | null, zone: string, ws: number, debited: number): SampleValue[] => [
  'Клуб 1',
  xlTime(open),
  close === null ? null : xlTime(close),
  zone,
  ws,
  'гость3',
  '+77012345612',
  19,
  'Тариф 1',
  debited,
  0,
  0.0625,
];
const DATA = { ...CLUB_DATA, load: [...CLUB_DATA.load, load('2026-11-02 10:00:00', null, 'Общий', 4, 0), load('2026-10-31 23:00:00', '2026-11-01 01:00:00', 'Общий', 5, 200)] };

async function setup() {
  x = await clubWorld(DATA);
  const res = await x.w.h.req('POST', `${x.c}/senet/connections/${x.conn}/sync`, { from: '2026-10-30T19:00:00.000Z', to: '2026-10-31T19:00:00.000Z' });
  expect(res.json().runs[0]).toMatchObject({ result: 'ok' });
  return x;
}

const report = async (query: string) => {
  const res = await x!.w.h.req('GET', `${x!.c}/club-analytics/load?${query}`);
  expect(res.statusCode, res.body).toBe(200);
  return res.json();
};
const PERIOD = 'from=2026-11-01&to=2026-11-02&step=day&compare=0';
/** Занято 01–02.11: VIP 5 400, «Общий» 3 — 5 400 и 3 600, «Общий» 5 — 3 600 (час 01.11 00:00–01:00). */
const TOTAL = 18_000 / (10 * 86_400 * 2);

describe('сборка ответа без базы', () => {
  const row = (zone: string, workstation: number | null, startAt: string) => ({ officeId: 1, zone, zoneName: zone, workstation, startAt, endAt: '2026-11-01T10:00:00.000Z', debited: 0, guestLogin: '', phoneMask: null });

  it('periodZones — зоны периода, которых нет среди известных: мест — разных мест сеансов', () => {
    const sessions = [row('A', 1, '2026-11-01T05:00:00.000Z'), row('A', 2, '2026-11-01T06:00:00.000Z'), row('A', 2, '2026-11-01T07:00:00.000Z'), row('B', 3, '2026-11-01T05:00:00.000Z')];
    expect(periodZones(sessions, new Set(['B']), (r) => `Клуб · ${r.zoneName}`)).toEqual([{ id: 'A', label: 'Клуб · A', seats: 2 }]);
  });

  it('buildLoadReport — зона без сеансов: загрузка 0, разрез по зонам; прошлый период без полных дней — null', () => {
    const grid = () => [Array.from({ length: 24 }, () => 0)];
    const cur: ClubLoadData = { days: ['2026-11-02'], cov: ['full'], occ: new Map([['A', grid()]]), seats: 2, seatsNote: null, zones: [{ id: 'A', label: 'A', seats: 1 }, { id: 'B', label: 'B', seats: 1 }], sessions: [] };
    const prev: ClubLoadData = { ...cur, cov: ['none'] };
    const r = buildLoadReport(cur, prev, { from: '2026-11-02', to: '2026-11-02', step: 'day', by: 'zones' }, '2026-11-01T19:00:00.000Z', '2026-11-02T19:00:00.000Z');
    expect(r.series).toEqual([{ id: 'A', label: 'A', values: [0] }, { id: 'B', label: 'B', values: [0] }]);
    expect(r.zones.map((z) => [z.id, z.load])).toEqual([['A', 0], ['B', 0], ['all', 0]]);
    expect(r.prevTotal).toBeNull();
    expect(r.prevCoverage).toEqual({ days: 1, withData: 0 });
    expect(r.meta).toMatchObject({ noZones: true, empty: false });
  });
});

describe('«Загрузка»', () => {
  it('загрузка за период: сеанс через начало периода — своими часами в периоде, сеанс без конца — нет', async () => {
    await setup();
    const r = await report(PERIOD);
    expect(r.total).toBeCloseTo(TOTAL, 12);
    expect(r.series).toEqual([{ id: 'all', label: 'Все зоны', values: [expect.any(Number), expect.any(Number)] }]);
    expect(r.series[0].values[0]).toBeCloseTo((5_400 + 1_800 + 3_600) / (10 * 86_400), 12);
    expect(r.prevTotal).toBeNull();
    expect(r.coverage).toMatchObject({ days: 2, withData: 2, missingDays: [] });
    expect(r.meta).toMatchObject({ from: '2026-11-01', to: '2026-11-02', step: 'day', by: 'all', empty: false, noZones: false });
  });

  it('по зонам; таблица зон со строкой «Все зоны»', async () => {
    await setup();
    const r = await report(`${PERIOD}&by=zones`);
    expect(r.series.map((s: { label: string }) => s.label)).toEqual(['Общий', 'VIP']);
    expect(r.zones.map((z: { label: string; seats: number }) => [z.label, z.seats])).toEqual([
      ['Общий', 3],
      ['VIP', 1],
      ['Все зоны', 10],
    ]);
    const vip = r.zones.find((z: { label: string }) => z.label === 'VIP');
    expect(vip).toMatchObject({ sessions: 1, avgSessionSec: 5_400, hours: 1.5, debited: 90_000, load: 5_400 / (1 * 86_400 * 2) });
    expect(r.zones.at(-1)).toMatchObject({ id: 'all', sessions: 3 });
  });

  it('места: своё число зон, расхождение с проектом, без «Количества ПК» — по зонам с подсказкой', async () => {
    await setup();
    expect((await report(PERIOD)).seats).toEqual({
      total: 10,
      zones: [
        { label: 'Общий', seats: 3 },
        { label: 'VIP', seats: 1 },
      ],
      note: 'По данным Senet в зонах 4 ПК, в проекте — 10. Проверьте «Количество ПК» или зоны',
    });
    await x!.w.h.req('PUT', `${x!.c}/senet/offices/${x!.office}/zones`, { zones: [{ zone: 'VIP', seats: 3 }, { zone: 'Общий', seats: 7 }] });
    expect((await report(PERIOD)).seats.note).toBeNull();
    await x!.w.h.t.q(`UPDATE projects SET template_params = '{}' WHERE id = ${x!.club}`);
    const r = await report(PERIOD);
    expect(r.seats).toMatchObject({ total: 10, note: 'Задайте количество ПК в карточке проекта' });
    expect(r.total).toBeCloseTo(TOTAL, 12);
  });

  it('текущий неполный день не входит в загрузку; карта и часы простоя', async () => {
    await setup();
    const r = await report('from=2026-11-01&to=2026-11-03&step=day&compare=1');
    expect(r.total).toBeCloseTo(TOTAL, 12);
    expect(r.series[0].values[2]).toBeNull();
    // 01.11 — воскресенье, единственное полное: VIP занят весь час 20:00–21:00
    expect(r.heatmap).toHaveLength(7);
    expect(r.heatmap[6][20]).toBeCloseTo(3_600 / (10 * 3_600), 12);
    expect(r.idle).toHaveLength(5);
    expect(r.idle.map((c: { value: number }) => c.value)).toEqual([...r.idle.map((c: { value: number }) => c.value)].sort((a, b) => a - b));
  });

  it('сеансы ячейки карты — с маской телефона, без хеша; Excel; чужой клуб — 404', async () => {
    await setup();
    const res = await x!.w.h.req('GET', `${x!.c}/club-analytics/load/rows?${PERIOD}&weekday=6&hour=20`);
    expect(res.statusCode, res.body).toBe(200);
    expect(res.json()).toEqual({ items: [expect.objectContaining({ kind: 'session', label: 'VIP · ПК 7', amount: 90_000, guest: 'гость1', phoneMask: '+7 *** ** 12' })], nextCursor: null });
    expect(res.body).not.toContain('phone_hash');
    expect(res.body).not.toContain('phoneHash');
    const xlsx = await x!.w.h.req('GET', `${x!.c}/club-analytics/load.xlsx?${PERIOD}`);
    expect(xlsx.statusCode, xlsx.body).toBe(200);
    expect(xlsx.headers['content-type']).toContain('spreadsheetml');
    expect((await x!.w.h.req('GET', `${x!.c}/club-analytics/load?${PERIOD}&project=999999`)).statusCode).toBe(404);
  });

  it('нет сеансов по зонам при данных за период — noZones', async () => {
    x = await clubWorld({ ...CLUB_DATA, load: [] });
    const r = await report(PERIOD);
    expect(r.meta.noZones).toBe(true);
    expect(r.total).toBe(0);
  });
});
