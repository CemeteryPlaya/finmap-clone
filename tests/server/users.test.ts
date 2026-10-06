import { afterEach, describe, expect, it } from 'vitest';
import { AppError } from '../../src/server/errors';
import { createAuditService } from '../../src/server/modules/audit/service';
import { createUsersService, normalizeLogin } from '../../src/server/modules/users/service';
import { users } from '../../src/server/db/schema';
import { hashPassword } from '../../src/server/modules/users/passwords';
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

  it('одновременное создание одного логина: один успех, второй — ошибка поля, а не 500 (Review Focus 1)', async () => {
    const { svc } = setup();
    const results = await Promise.allSettled([
      svc.create({ login: 'twin', name: 'А', password: 'correct-horse-1' }, null),
      svc.create({ login: 'TWIN', name: 'Б', password: 'correct-horse-1' }, null),
    ]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    const rejected = results.find((r) => r.status === 'rejected') as PromiseRejectedResult;
    expect(rejected.reason).toMatchObject({ status: 400, fields: { login: 'Логин уже занят' } });
  });

  it('нельзя отключить последнего активного пользователя', async () => {
    const { svc } = setup();
    const a = await svc.create({ login: 'alpha', name: 'А', password: 'correct-horse-1' }, null);
    const b = await svc.create({ login: 'beta', name: 'Б', password: 'correct-horse-1' }, null);
    await svc.update(b.id, { disabled: true }, a.id);
    // действие из консоли или от несуществующего актора: a — последний активный
    await expect(svc.update(a.id, { disabled: true }, 999)).rejects.toMatchObject({
      status: 422,
      code: 'USER_LOCKOUT',
      message: 'Нельзя отключить последнего активного пользователя',
    });
  });

  it('параллельное взаимное отключение с паролем не оставляет экземпляр без активных пользователей', async () => {
    const { svc } = setup();
    const a = await svc.create({ login: 'alpha', name: 'А', password: 'correct-horse-1' }, null);
    const b = await svc.create({ login: 'beta', name: 'Б', password: 'correct-horse-1' }, null);
    // await hashPassword внутри update — окно, в котором раньше обе проверки «активных > 1» проходили
    const results = await Promise.allSettled([
      svc.update(b.id, { disabled: true, password: 'reset-pass-11' }, a.id),
      svc.update(a.id, { disabled: true, password: 'reset-pass-22' }, b.id),
    ]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    const rejected = results.find((r) => r.status === 'rejected') as PromiseRejectedResult;
    expect(rejected.reason).toMatchObject({ code: 'USER_LOCKOUT' });
    expect(svc.list().filter((u) => u.disabledAt === null)).toHaveLength(1);
  });

  it('смена своего пароля: если администратор сбросил пароль, пока шёл хэш, — 409 и сброс не затирается', async () => {
    const { svc } = setup();
    const a = await svc.create({ login: 'alpha', name: 'А', password: 'correct-horse-1' }, null);
    const resetHash = await hashPassword('admin-reset-1');
    // changeOwnPassword читает строку синхронно и затем уходит в await verifyPassword; подмена хэша сразу после вызова
    // (до первого await) детерминированно попадает в окно между чтением и транзакцией
    const pending = svc.changeOwnPassword(a.id, 'correct-horse-1', 'self-chosen-pass-1', null);
    t.sqlite.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(resetHash, a.id);
    await expect(pending).rejects.toMatchObject({ status: 409, code: 'VERSION_CONFLICT' });
    expect(await svc.verifyCredentials('alpha', 'admin-reset-1')).toMatchObject({ id: a.id });
    expect(await svc.verifyCredentials('alpha', 'self-chosen-pass-1')).toBeNull();
  });

  it('setPasswordByLogin (user:passwd): новый пароль, все сессии пользователя завершены', async () => {
    const { svc } = setup();
    const u = await svc.create({ login: 'admin', name: 'А', password: 'correct-horse-1' }, null);
    t.sqlite
      .prepare("INSERT INTO sessions (token_hash, user_id, remember, created_at, expires_at, last_seen_at) VALUES ('h', ?, 0, 'x', 'x', 'x')")
      .run(u.id);
    expect(await svc.setPasswordByLogin(' ADMIN ', 'console-pass-1')).toMatchObject({ login: 'admin', disabledAt: null });
    expect(await svc.verifyCredentials('admin', 'console-pass-1')).toMatchObject({ id: u.id });
    expect((t.sqlite.prepare('SELECT COUNT(*) n FROM sessions').get() as { n: number }).n).toBe(0);
    await expect(svc.setPasswordByLogin('nobody', 'console-pass-1')).rejects.toMatchObject({ status: 404 });
    await expect(svc.setPasswordByLogin('admin', 'short')).rejects.toMatchObject({ status: 400 });
  });
});
