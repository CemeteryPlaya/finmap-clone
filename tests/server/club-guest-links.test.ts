import { afterEach, describe, expect, it } from 'vitest';
import { companies, senetConnections, senetGuestLinks, senetOffices } from '../../src/server/db/schema';
import { companyGuests, companyPairs, keyRef } from '../../src/server/modules/club-analytics/guest-links';
import { CLUB_DATA, clubWorld, type ClubWorld } from '../helpers/club-senet';

/** Ручные правки гостей (спецификация «Аналитика клуба», §7.1, R18, R25; план АК-3, задача 3). Хеши телефонов — синтетические. */
let x: ClubWorld | null = null;
afterEach(async () => {
  await x?.close();
  x = null;
});

const NOW = '2026-11-03T06:00:00.000Z';
const EMPTY = { ...CLUB_DATA, load: [], refills: [], tickets: [] };
const HASHES = ['hash-aaa-1', 'hash-bbb-2', 'hash-ccc-3'];

async function session(officeId: number, at: string, login: string, hash: string | null) {
  await x!.w.h.t.q(
    'INSERT INTO senet_load (office_id, start_at, end_at, zone, workstation, guest_login, phone_hash, phone_mask) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
    officeId,
    at,
    new Date(Date.parse(at) + 3_600_000).toISOString(),
    'VIP',
    1,
    login,
    hash,
    hash ? `+7 *** ** ${hash.slice(-1)}2` : null,
  );
}

const links = (body: unknown) => x!.w.h.req('POST', `${x!.c}/club-analytics/guests/links`, body);
const guestsNow = async () => (await companyGuests(x!.w.h.t.db, x!.w.cid, NOW)).guests.keys;

describe('ручные правки гостей', () => {
  it('пары — по всем клубам компании; одна пара из сеанса и пополнения; чужая компания не видна', async () => {
    x = await clubWorld(EMPTY);
    await session(x.office, '2026-11-01T10:00:00.000Z', 'Ivan', HASHES[0]!);
    await x.w.h.t.q('INSERT INTO senet_refills (office_id, at, guest_login, amount, phone_hash, phone_mask) VALUES (?, ?, ?, ?, ?, ?)', x.office, '2026-11-02T10:00:00.000Z', 'Ivan', 100, HASHES[0], '+7 *** ** 12');
    const other = (await x.w.h.t.db.insert(companies).values({ name: 'Чужая', baseCurrency: 'KZT', createdAt: 'x' }).returning())[0]!;
    const conn = (await x.w.h.t.db.insert(senetConnections).values({ companyId: other.id, name: 'Ч', org: 'o', authMethod: 'password', credentialsSecret: 'x', credentialsHint: 'x', createdAt: 'x', createdBy: Number((await x.w.h.t.q('SELECT MIN(id) id FROM users'))[0]!.id) }).returning())[0]!;
    const office = (await x.w.h.t.db.insert(senetOffices).values({ connectionId: conn.id, senetOfficeId: 9 }).returning())[0]!;
    await session(office.id, '2026-11-01T10:00:00.000Z', 'Чужой', HASHES[2]!);
    const pairs = await companyPairs(x.w.h.t.db, x.w.cid);
    expect(pairs).toEqual([{ login: 'Ivan', phoneHash: HASHES[0], phoneMask: expect.any(String), lastAt: '2026-11-02T10:00:00.000Z' }]);
  });

  it('«Это один гость» связывает логины без общего телефона; строка истории без хешей; повтор — та же правка', async () => {
    x = await clubWorld(EMPTY);
    await session(x.office, '2026-11-01T10:00:00.000Z', 'a', HASHES[0]!);
    await session(x.office, '2026-11-01T12:00:00.000Z', 'b', HASHES[1]!);
    expect(await guestsNow()).toHaveLength(2);
    const body = { kind: 'merge', a: keyRef('login:a'), b: keyRef('login:b') };
    const res = await links(body);
    expect(res.statusCode, res.body).toBe(200);
    expect(await guestsNow()).toEqual([['login:a', 'login:b', `phone:${HASHES[0]}`, `phone:${HASHES[1]}`]]);
    const history = await x.w.h.t.q("SELECT action, diff FROM audit_log WHERE entity = 'senet_guest_link'");
    expect(history).toHaveLength(1);
    expect(JSON.parse(String(history[0]!.diff))).toEqual({ after: { kind: 'merge', a: 'a', b: 'b' } });
    expect(JSON.stringify(history)).not.toMatch(/hash-/);
    expect((await links(body)).json()).toEqual(res.json());
    expect(await x.w.h.t.q("SELECT COUNT(*) n FROM audit_log WHERE entity = 'senet_guest_link'")).toEqual([{ n: 1 }]);
  });

  it('«Разделить» телефон гостя из двух логинов, затем «Снять правку» — как было', async () => {
    x = await clubWorld(EMPTY);
    await session(x.office, '2026-11-01T10:00:00.000Z', 'a', HASHES[0]!);
    await session(x.office, '2026-11-01T12:00:00.000Z', 'b', HASHES[0]!);
    const res = await links({ kind: 'split', a: keyRef(`phone:${HASHES[0]}`), b: keyRef('login:a') });
    expect(res.statusCode, res.body).toBe(200);
    expect(await guestsNow()).toHaveLength(3);
    const history = await x.w.h.t.q("SELECT diff FROM audit_log WHERE entity = 'senet_guest_link'");
    expect(JSON.parse(String(history[0]!.diff)).after).toEqual({ kind: 'split', a: '+7 *** ** 12', b: '+7 *** ** 12' });
    const del = await x.w.h.req('DELETE', `${x.c}/club-analytics/guests/links/${res.json().id}`);
    expect(del.statusCode, del.body).toBe(204);
    expect(await guestsNow()).toHaveLength(1);
    expect(await x.w.h.t.q("SELECT action FROM audit_log WHERE entity = 'senet_guest_link' ORDER BY id")).toEqual([{ action: 'create' }, { action: 'delete' }]);
  });

  it('ошибки: нечего разделять, уже один гость, неизвестный гость, архивная компания, чужая правка', async () => {
    x = await clubWorld(EMPTY);
    await session(x.office, '2026-11-01T10:00:00.000Z', 'a', null);
    await session(x.office, '2026-11-01T12:00:00.000Z', 'b', HASHES[1]!);
    expect((await links({ kind: 'split', a: keyRef('login:a'), b: keyRef('login:a') })).statusCode).toBe(422);
    expect((await links({ kind: 'merge', a: keyRef('login:b'), b: keyRef(`phone:${HASHES[1]}`) })).statusCode).toBe(422);
    expect((await links({ kind: 'merge', a: keyRef('login:a'), b: keyRef('login:zzz') })).statusCode).toBe(404);
    expect((await links({ kind: 'merge', a: 'не ссылка', b: keyRef('login:a') })).statusCode).toBe(400);

    const other = (await x.w.h.t.db.insert(companies).values({ name: 'Чужая', baseCurrency: 'KZT', createdAt: 'x' }).returning())[0]!;
    const foreign = (await x.w.h.t.db.insert(senetGuestLinks).values({ companyId: other.id, keyA: 'login:a', keyB: 'login:b', kind: 'merge', createdAt: 'x' }).returning())[0]!;
    expect((await x.w.h.req('DELETE', `${x.c}/club-analytics/guests/links/${foreign.id}`)).statusCode).toBe(404);

    await x.w.h.t.q('UPDATE companies SET archived_at = ? WHERE id = ?', '2026-11-03T00:00:00.000Z', x.w.cid);
    expect((await links({ kind: 'merge', a: keyRef('login:a'), b: keyRef('login:b') })).statusCode).toBe(422);
  });

  it('ссылка на ключ — 16 hex, хеш из неё не виден', () => {
    const ref = keyRef(`phone:${HASHES[0]}`);
    expect(ref).toMatch(/^[0-9a-f]{16}$/);
    expect(ref).not.toContain(HASHES[0]);
    expect(keyRef('login:a')).not.toBe(ref);
  });
});
