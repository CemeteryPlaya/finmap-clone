import { afterEach, describe, expect, it } from 'vitest';
import { clubWorld, type ClubWorld } from '../helpers/club-senet';

/** Зоны клуба Senet (спецификация «Аналитика клуба», §6.1; план АК-2, задача 2). Сеансы фикстуры: «VIP» место 7, «Общий» место 3. */
let x: ClubWorld | null = null;
afterEach(async () => {
  await x?.close();
  x = null;
});

const zonesUrl = () => `${x!.c}/senet/offices/${x!.office}/zones`;
const get = async () => {
  const res = await x!.w.h.req('GET', zonesUrl());
  expect(res.statusCode, res.body).toBe(200);
  return res.json().zones as { zone: string; found: number; seats: number | null }[];
};
const put = (zones: unknown) => x!.w.h.req('PUT', zonesUrl(), { zones });

describe('зоны клуба', () => {
  it('зоны по данным за 30 дней — по имени; своё число мест сохраняется, пустое — удаляет; история', async () => {
    x = await clubWorld();
    expect(await get()).toEqual([
      { zone: 'Общий', found: 1, seats: null },
      { zone: 'VIP', found: 1, seats: null },
    ]);
    const res = await put([{ zone: 'VIP', seats: 10 }]);
    expect(res.statusCode, res.body).toBe(200);
    expect(res.json().zones).toEqual([
      { zone: 'Общий', found: 1, seats: null },
      { zone: 'VIP', found: 1, seats: 10 },
    ]);
    const history = await x.w.h.t.q("SELECT entity, action, diff FROM audit_log WHERE entity = 'senet_office' AND action = 'update'");
    expect(history).toHaveLength(1);
    expect(JSON.parse(String(history[0]!.diff))).toEqual({ before: { zones: '' }, after: { zones: 'VIP 10' } });

    await put([{ zone: 'VIP', seats: null }]);
    expect((await get())[1]).toEqual({ zone: 'VIP', found: 1, seats: null });
  });

  it('сохранённая зона без сеансов за 30 дней остаётся в списке', async () => {
    x = await clubWorld();
    await put([{ zone: 'Консоли', seats: 4 }]);
    expect(await get()).toContainEqual({ zone: 'Консоли', found: 0, seats: 4 });
  });

  it('проверки: мест 0 — 400; чужой клуб — 404; архивная компания — только чтение', async () => {
    x = await clubWorld();
    expect((await put([{ zone: 'VIP', seats: 0 }])).statusCode).toBe(400);
    expect((await x.w.h.req('GET', `${x.c}/senet/offices/999999/zones`)).statusCode).toBe(404);
    await x.w.h.t.q('UPDATE companies SET archived_at = ? WHERE id = ?', '2026-11-03T00:00:00.000Z', x.w.cid);
    expect((await put([{ zone: 'VIP', seats: 5 }])).statusCode).toBe(422);
    expect(await get()).toHaveLength(2);
  });

  it('удаление подключения с зонами — без ошибки, зоны удалены', async () => {
    x = await clubWorld();
    await put([{ zone: 'VIP', seats: 10 }]);
    const res = await x.w.h.req('DELETE', `${x.c}/senet/connections/${x.conn}`);
    expect(res.statusCode, res.body).toBeLessThan(300);
    expect(await x.w.h.t.q('SELECT COUNT(*) n FROM senet_zones')).toEqual([{ n: 0 }]);
  });
});
