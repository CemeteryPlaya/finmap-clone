import crypto from 'node:crypto';
import { afterEach, describe, expect, it } from 'vitest';
import { clubScope } from '../../src/server/modules/club-analytics/scope';
import { opsWorld, type OpsWorld } from '../helpers/ops';
import { startSenetFake, type SenetFake } from '../helpers/senet-fake';

/** Клубы компании для аналитики клуба (спецификация «Аналитика клуба», §3.1; план АК-1, задача 4). */
const KEY = crypto.randomBytes(32).toString('base64');
let w: OpsWorld | null = null;
let fake: SenetFake | null = null;
afterEach(async () => {
  await w?.h.t.cleanup();
  await fake?.close();
  w = null;
  fake = null;
});

async function setup() {
  fake = await startSenetFake({ users: { reports: { password: 'p-1', token: 'tok-1' } } });
  w = await opsWorld('2026-11-03T12:00:00.000Z', { SENET_API_BASE: fake.base, SECRET_KEY: KEY });
  const c = `/api/v1/companies/${w.cid}`;
  const club = (await w.post(`${c}/projects`, { name: 'Клуб 3', templateKey: 'computer-club', templateParams: { pcCount: 40 } })).project.id as number;
  const bare = (await w.post(`${c}/projects`, { name: 'Клуб 4', templateKey: 'computer-club', templateParams: { pcCount: 10 } })).project.id as number;
  await w.h.t.q("UPDATE projects SET template_params = '{}' WHERE id = ?", bare);
  const connect = async (name: string) => (await w!.post(`${c}/senet/connections`, { name, org: 'club-demo', authMethod: 'password', username: 'reports', password: 'p-1' })).connection.id as number;
  const conn1 = await connect('К1');
  const conn2 = await connect('К2');
  const office = async (conn: number, senetOfficeId: number, projectId: number | null) =>
    (await w!.post(`${c}/senet/connections/${conn}/offices`, { senetOfficeId, cashDeskId: 1, enabled: false, projectId })).office.id as number;
  const o1 = await office(conn1, 1, club);
  const o2 = await office(conn2, 2, bare);
  await office(conn1, 3, null);
  await w.h.t.q('UPDATE senet_connections SET last_sync_at = ? WHERE id = ?', '2026-11-03T10:00:00.000Z', conn1);
  await w.h.t.q('UPDATE senet_connections SET last_sync_at = ? WHERE id = ?', '2026-11-03T08:00:00.000Z', conn2);
  return { club, bare, o1, o2, conn1 };
}

describe('клубы компании', () => {
  it('проекты-клубы с ПК, клубы Senet с проектом (и выключенные), свежесть — самый ранний забор', async () => {
    const s = await setup();
    const scope = await clubScope(w!.h.t.db, w!.cid);
    expect(scope.projects).toEqual([
      { id: s.club, name: 'Клуб 3', archived: false, pcCount: 40 },
      { id: s.bare, name: 'Клуб 4', archived: false, pcCount: null },
    ]);
    expect(scope.offices.map((o) => [o.id, o.projectId])).toEqual([
      [s.o1, s.club],
      [s.o2, s.bare],
    ]);
    expect(scope.connected).toBe(true);
    expect(scope.freshness).toBe('2026-11-03T08:00:00.000Z');
    const one = await clubScope(w!.h.t.db, w!.cid, s.club);
    expect(one.offices.map((o) => o.id)).toEqual([s.o1]);
    expect(one.freshness).toBe('2026-11-03T10:00:00.000Z');
  });

  it('проект «Общий» — не клуб: 404; без подключений — connected false; маршрут scope', async () => {
    w = await opsWorld();
    await expect(clubScope(w.h.t.db, w.cid, w.project)).rejects.toMatchObject({ status: 404, message: 'Клуб не найден' });
    const scope = await clubScope(w.h.t.db, w.cid);
    expect(scope).toEqual({ projects: [], offices: [], connected: false, freshness: null });
    const res = await w.h.req('GET', `/api/v1/companies/${w.cid}/club-analytics/scope`);
    expect(res.json()).toEqual({ projects: [], hasOffices: false, connected: false, freshness: null });
  });
});
