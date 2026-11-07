import { afterEach, describe, expect, it } from 'vitest';
import { opsWorld, type OpsWorld } from '../helpers/ops';

/** «Настройки → Аналитика» (спецификация «Аналитика клуба», §10; план АК-1, задача 2): общие для компании, с историей. */
let w: OpsWorld | null = null;
afterEach(async () => {
  await w?.h.t.cleanup();
  w = null;
});

const base = () => `/api/v1/companies/${w!.cid}/analytics-settings`;
const get = async () => (await w!.h.req('GET', base())).json();
const club = () => w!.post(`/api/v1/companies/${w!.cid}/projects`, { name: 'Клуб 3', templateKey: 'computer-club', templateParams: { pcCount: 40 } });
const tilesBody = (visible: number) => ({
  items: ['revenue', 'load', 'guests', 'newGuests', 'revenuePerGuest', 'revenuePerPcDay', 'barShare', 'barMargin', 'refills', 'visitDuration', 'visitsPerGuest', 'returningShare', 'payrollToRevenue', 'rentToRevenue'].map(
    (key, i) => ({ key, visible: i < visible }),
  ),
});

describe('настройки аналитики компании', () => {
  it('без проекта-клуба — только «Финансы»; с проектом — группа шаблона и плитки по умолчанию', async () => {
    w = await opsWorld();
    const none = await get();
    expect(none.groups).toEqual([{ key: 'finance', title: 'Финансы' }]);
    expect(none.dashboards.groups.map((g: { key: string }) => g.key)).toEqual(['finance']);
    expect(none.tiles).toEqual({});
    await club();
    const s = await get();
    expect(s.groups).toEqual([
      { key: 'finance', title: 'Финансы' },
      { key: 'computer-club', title: 'Компьютерный клуб' },
    ]);
    expect(s.dashboards.groups[1]).toEqual({
      key: 'computer-club',
      visible: true,
      cards: [
        { key: 'overview', visible: true },
        { key: 'revenue', visible: true },
        { key: 'load', visible: true },
        { key: 'guests', visible: true },
        { key: 'bar', visible: true },
      ],
    });
    expect(s.dashboards.groups[0].cards.map((c: { key: string }) => c.key)).toEqual(['cashflow', 'pnl', 'statement', 'projects', 'indicators', 'history']);
    expect(s.tiles['computer-club'].items.filter((i: { visible: boolean }) => i.visible)).toHaveLength(8);
    expect(s.catalog['computer-club'].dashboards[0]).toMatchObject({ key: 'overview', title: 'Обзор клуба', path: 'club' });
  });

  it('сохранение: карточка скрыта, история пишется один раз; 13 плиток — 400; «Вернуть как было»', async () => {
    w = await opsWorld();
    await club();
    const hidden = { groups: [{ key: 'computer-club', visible: true, cards: [{ key: 'overview', visible: true }, { key: 'revenue', visible: false }] }] };
    const put = await w.h.req('PUT', `${base()}/dashboards`, hidden);
    expect(put.statusCode).toBe(200);
    expect(put.json().dashboards.groups[0].cards[1]).toEqual({ key: 'revenue', visible: false });
    // настройка, сохранённая до «Загрузки» (АК-2), получает её карточку в конце видимой (§10.3)
    expect(put.json().dashboards.groups[0].cards[2]).toEqual({ key: 'load', visible: true });
    expect((await get()).dashboards.groups[0].key).toBe('computer-club');
    expect(await w.h.auditCount('analytics_settings', 'update')).toBe(1);
    await w.h.req('PUT', `${base()}/dashboards`, hidden);
    expect(await w.h.auditCount('analytics_settings', 'update')).toBe(1);

    const many = await w.h.req('PUT', `${base()}/tiles.computer-club`, tilesBody(13));
    expect(many.statusCode).toBe(400);
    expect(many.json().error.fields).toEqual({ items: 'Не больше 12 плиток' });
    expect((await w.h.req('PUT', `${base()}/tiles.computer-club`, tilesBody(12))).statusCode).toBe(200);
    expect((await get()).tiles['computer-club'].items.filter((i: { visible: boolean }) => i.visible)).toHaveLength(12);

    expect((await w.h.req('DELETE', `${base()}/tiles.computer-club`)).statusCode).toBe(200);
    expect((await get()).tiles['computer-club'].items.filter((i: { visible: boolean }) => i.visible)).toHaveLength(8);
    expect(await w.h.auditCount('analytics_settings', 'delete')).toBe(1);
  });

  it('неизвестный ключ — 404, шаблон без проектов — 404; архивная компания читается, но не пишется', async () => {
    w = await opsWorld();
    expect((await w.h.req('PUT', `${base()}/whatever`, {})).statusCode).toBe(404);
    expect((await w.h.req('PUT', `${base()}/tiles.computer-club`, tilesBody(8))).statusCode).toBe(404);
    expect((await w.h.req('PUT', `${base()}/dashboards`, { groups: 'нет' })).statusCode).toBe(400);
    await club();
    await w.h.t.q('UPDATE companies SET archived_at = ? WHERE id = ?', '2026-10-06T00:00:00.000Z', w.cid);
    expect((await w.h.req('PUT', `${base()}/dashboards`, { groups: [] })).statusCode).toBe(422);
    expect((await w.h.req('GET', base())).statusCode).toBe(200);
  });
});
