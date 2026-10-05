import { afterEach, describe, expect, it } from 'vitest';
import { AppError } from '../../src/server/errors';
import { createAuditService } from '../../src/server/modules/audit/service';
import { createUsersService, normalizeLogin } from '../../src/server/modules/users/service';
import { users } from '../../src/server/db/schema';
import { createTestDb } from '../helpers/test-db';

let t: ReturnType<typeof createTestDb>;
afterEach(() => t?.cleanup());

function setup() {
  t = createTestDb();
  const audit = createAuditService(t.db);
  return { audit, svc: createUsersService(t.db, audit) };
}

describe('users', () => {
  it('normalizeLogin обрезает пробелы и приводит к нижнему регистру', () => {
    expect(normalizeLogin('  Admin ')).toBe('admin');
  });

  it('создаёт пользователя, хранит argon2id-хэш и пишет историю', async () => {
    const { svc, audit } = setup();
    const u = await svc.create({ login: ' Admin ', name: 'Владелец', password: 'correct-horse-1' }, null);
    expect(u).toEqual({ id: u.id, login: 'admin', name: 'Владелец' });
    const row = t.db.select().from(users).all()[0]!;
    expect(row.passwordHash.startsWith('$argon2id$')).toBe(true);
    expect(audit.list({ companyId: null })[0]).toMatchObject({ entity: 'user', action: 'create', diff: { login: 'admin', name: 'Владелец' } });
  });

  it('вход нечувствителен к регистру и пробелам логина (Review Focus 1)', async () => {
    const { svc } = setup();
    await svc.create({ login: 'admin', name: 'В', password: 'correct-horse-1' }, null);
    expect(await svc.verifyCredentials(' ADMIN ', 'correct-horse-1')).toMatchObject({ login: 'admin' });
    expect(await svc.verifyCredentials('admin', 'wrong-password')).toBeNull();
    expect(await svc.verifyCredentials('nobody', 'correct-horse-1')).toBeNull();
  });

  it('отклоняет короткий пароль, плохой логин и дубликат', async () => {
    const { svc } = setup();
    await expect(svc.create({ login: 'admin', name: 'В', password: 'short' }, null)).rejects.toMatchObject({
      status: 400,
      code: 'VALIDATION',
      fields: { password: 'Пароль должен быть не короче 10 символов' },
    });
    await expect(svc.create({ login: 'а б', name: 'В', password: 'correct-horse-1' }, null)).rejects.toBeInstanceOf(AppError);
    await svc.create({ login: 'admin', name: 'В', password: 'correct-horse-1' }, null);
    await expect(svc.create({ login: 'ADMIN', name: 'Д', password: 'correct-horse-1' }, null)).rejects.toMatchObject({
      fields: { login: 'Логин уже занят' },
    });
  });

  it('отключённый пользователь не входит и не считается активным', async () => {
    const { svc } = setup();
    const u = await svc.create({ login: 'admin', name: 'В', password: 'correct-horse-1' }, null);
    t.sqlite.prepare('UPDATE users SET disabled_at = ? WHERE id = ?').run(new Date().toISOString(), u.id);
    expect(await svc.verifyCredentials('admin', 'correct-horse-1')).toBeNull();
    expect(svc.getActive(u.id)).toBeNull();
    expect(svc.count()).toBe(1);
  });
});
