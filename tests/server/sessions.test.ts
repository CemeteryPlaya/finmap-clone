import { afterEach, describe, expect, it } from 'vitest';
import { createAuditService } from '../../src/server/modules/audit/service';
import { createSessionsService, REMEMBER_TTL_MS, SESSION_TTL_MS } from '../../src/server/modules/auth/sessions';
import { createUsersService } from '../../src/server/modules/users/service';
import { sessions } from '../../src/server/db/schema';
import { createTestDb, type TestDb } from '../helpers/test-db';

let t: TestDb;
afterEach(() => t?.cleanup());

async function setup() {
  t = await createTestDb();
  let now = new Date('2026-10-05T10:00:00.000Z');
  const clock = { set: (iso: string) => (now = new Date(iso)), now: () => now };
  const users = createUsersService(t.db, createAuditService(t.db));
  const u = await users.create({ login: 'admin', name: 'В', password: 'correct-horse-1' }, null);
  const svc = createSessionsService(t.db, users, clock.now);
  return { svc, u, clock, users };
}

describe('sessions', () => {
  it('хранит только хэш токена и находит пользователя по токену', async () => {
    const { svc, u } = await setup();
    const s = await svc.create({ userId: u.id, remember: false, ip: '1.1.1.1', userAgent: 'test' });
    const row = (await t.db.select().from(sessions))[0]!;
    expect(row.tokenHash).not.toBe(s.token);
    expect(row.tokenHash).toMatch(/^[0-9a-f]{64}$/);
    expect(await svc.touch(s.token)).toEqual({ id: s.id, user: { id: u.id, login: 'admin', name: 'В' }, renewed: null });
    expect(await svc.touch('неизвестный')).toBeNull();
  });

  it('истекает через 12 часов без активности и продлевается при активности', async () => {
    const { svc, u, clock } = await setup();
    const s = await svc.create({ userId: u.id, remember: false, ip: null, userAgent: null });
    expect(s.expiresAt.getTime() - new Date('2026-10-05T10:00:00.000Z').getTime()).toBe(SESSION_TTL_MS);
    clock.set('2026-10-05T21:00:00.000Z');
    expect(await svc.touch(s.token)).not.toBeNull(); // продлила до 09:00 следующего дня
    clock.set('2026-10-06T08:59:00.000Z');
    expect(await svc.touch(s.token)).not.toBeNull();
    clock.set('2026-10-06T21:00:00.000Z');
    expect(await svc.touch(s.token)).toBeNull();
  });

  it('remember даёт 30 дней', async () => {
    const { svc, u } = await setup();
    const s = await svc.create({ userId: u.id, remember: true, ip: null, userAgent: null });
    expect(s.expiresAt.getTime() - new Date('2026-10-05T10:00:00.000Z').getTime()).toBe(REMEMBER_TTL_MS);
  });

  it('lastSeenAt пишется не чаще раза в 5 минут', async () => {
    const { svc, u, clock } = await setup();
    const s = await svc.create({ userId: u.id, remember: false, ip: null, userAgent: null });
    clock.set('2026-10-05T10:04:00.000Z');
    await svc.touch(s.token);
    expect((await t.db.select().from(sessions))[0]!.lastSeenAt).toBe('2026-10-05T10:00:00.000Z');
    clock.set('2026-10-05T10:06:00.000Z');
    await svc.touch(s.token);
    expect((await t.db.select().from(sessions))[0]!.lastSeenAt).toBe('2026-10-05T10:06:00.000Z');
  });

  it('revoke и revokeAllForUser удаляют сессии; отключённый пользователь не проходит', async () => {
    const { svc, u } = await setup();
    const a = await svc.create({ userId: u.id, remember: false, ip: null, userAgent: null });
    const b = await svc.create({ userId: u.id, remember: false, ip: null, userAgent: null });
    const c = await svc.create({ userId: u.id, remember: false, ip: null, userAgent: null });
    await svc.revoke(a.token);
    expect(await svc.touch(a.token)).toBeNull();
    await svc.revokeAllForUser(u.id, b.id);
    expect(await svc.touch(b.token)).not.toBeNull();
    expect(await svc.touch(c.token)).toBeNull();
    await t.q('UPDATE users SET disabled_at = ? WHERE id = ?', '2026-10-05T10:00:00.000Z', u.id);
    expect(await svc.touch(b.token)).toBeNull();
  });

  it('touch сообщает о продлении: remember — новый срок, свежая сессия — null', async () => {
    const { svc, u, clock } = await setup();
    const s = await svc.create({ userId: u.id, remember: true, ip: null, userAgent: null });
    clock.set('2026-10-05T10:04:00.000Z');
    expect((await svc.touch(s.token))!.renewed).toBeNull();
    clock.set('2026-10-05T10:06:00.000Z');
    const r = (await svc.touch(s.token))!.renewed!;
    expect(r.remember).toBe(true);
    expect(r.expiresAt.getTime()).toBe(new Date('2026-10-05T10:06:00.000Z').getTime() + REMEMBER_TTL_MS);
    const s2 = await svc.create({ userId: u.id, remember: false, ip: null, userAgent: null });
    clock.set('2026-10-05T10:20:00.000Z');
    expect((await svc.touch(s2.token))!.renewed!.remember).toBe(false);
  });
});
