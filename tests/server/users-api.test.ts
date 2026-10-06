import { afterEach, describe, expect, it } from 'vitest';
import { createApi, type ApiHarness } from '../helpers/api';
import { loginAs, ORIGIN_HEADERS } from '../helpers/test-app';

let h: ApiHarness;
afterEach(async () => h?.t.cleanup());

const PASS = 'kassir-pass-1';

/** Запрос от имени другого пользователя (своя кука). */
const as = (cookie: string, method: 'GET' | 'POST' | 'PATCH', url: string, payload?: object) =>
  h.t.app.inject({ method, url, headers: { ...ORIGIN_HEADERS, cookie }, ...(payload ? { payload } : {}) });

async function addKassir() {
  const res = await h.req('POST', '/api/v1/users', { login: 'Kassir', name: 'Кассир', password: PASS });
  expect(res.statusCode).toBe(201);
  return res.json().user as { id: number; login: string };
}

describe('users API', () => {
  it('список и создание; дубль логина — ошибка поля; пароль не попадает в историю', async () => {
    h = await createApi();
    const user = await addKassir();
    expect(user).toMatchObject({ login: 'kassir', disabledAt: null });
    expect(user).not.toHaveProperty('passwordHash');
    const list = (await h.req('GET', '/api/v1/users')).json().users as { login: string }[];
    expect(list.map((u) => u.login)).toEqual(['admin', 'kassir']);
    const dup = await h.req('POST', '/api/v1/users', { login: 'KASSIR', name: 'Д', password: PASS });
    expect(dup.json().error.fields.login).toBe('Логин уже занят');
    const diffs = h.t.sqlite.prepare("SELECT diff FROM audit_log WHERE entity = 'user'").all() as { diff: string | null }[];
    expect(diffs.some((d) => d.diff?.includes(PASS))).toBe(false);
  });

  it('сброс пароля другому пользователю завершает его сессии (Review Focus 2)', async () => {
    h = await createApi();
    const k = await addKassir();
    const kassir = await loginAs(h.t, 'kassir', PASS);
    expect((await as(kassir, 'GET', '/api/v1/auth/me')).statusCode).toBe(200);
    const res = await h.req('PATCH', `/api/v1/users/${k.id}`, { password: 'new-kassir-pass' });
    expect(res.statusCode).toBe(200);
    expect((await as(kassir, 'GET', '/api/v1/auth/me')).statusCode).toBe(401);
    await expect(loginAs(h.t, 'kassir', PASS)).rejects.toThrow();
    await loginAs(h.t, 'kassir', 'new-kassir-pass');
    expect(h.auditCount('user', 'password_change')).toBe(1);
  });

  it('свой пароль через PATCH /users/:id нельзя — только в профиле', async () => {
    h = await createApi();
    const me = (await h.req('GET', '/api/v1/auth/me')).json().user as { id: number };
    const res = await h.req('PATCH', `/api/v1/users/${me.id}`, { password: 'another-pass-1' });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.fields.password).toBe('Свой пароль меняйте в профиле — нужен текущий пароль');
  });

  it('отключение: сессии завершены, вход запрещён; себя отключить нельзя; включение возвращает вход', async () => {
    h = await createApi();
    const me = (await h.req('GET', '/api/v1/auth/me')).json().user as { id: number };
    const k = await addKassir();
    const kassir = await loginAs(h.t, 'kassir', PASS);
    const off = await h.req('PATCH', `/api/v1/users/${k.id}`, { disabled: true });
    expect(off.json().user.disabledAt).not.toBeNull();
    expect((await as(kassir, 'GET', '/api/v1/auth/me')).statusCode).toBe(401);
    await expect(loginAs(h.t, 'kassir', PASS)).rejects.toThrow();

    const self = await h.req('PATCH', `/api/v1/users/${me.id}`, { disabled: true });
    expect(self.statusCode).toBe(422);
    expect(self.json().error).toMatchObject({ code: 'USER_LOCKOUT', message: 'Нельзя отключить самого себя' });

    expect((await h.req('PATCH', `/api/v1/users/${k.id}`, { disabled: false })).json().user.disabledAt).toBeNull();
    await loginAs(h.t, 'kassir', PASS);
  });

  it('переименование; PATCH без изменений не пишет историю', async () => {
    h = await createApi();
    const k = await addKassir();
    expect((await h.req('PATCH', `/api/v1/users/${k.id}`, { name: ' Старший\u200B кассир ' })).json().user.name).toBe('Старший кассир');
    await h.req('PATCH', `/api/v1/users/${k.id}`, { name: 'Старший кассир', disabled: false });
    expect(h.auditCount('user', 'update')).toBe(1);
    expect((await h.req('PATCH', '/api/v1/users/999', { name: 'X' })).statusCode).toBe(404);
  });

  it('смена своего пароля: текущая сессия жива, остальные завершены (Review Focus 3)', async () => {
    h = await createApi();
    const other = await loginAs(h.t); // тот же admin на другом устройстве
    const wrong = await h.req('POST', '/api/v1/auth/password', { currentPassword: 'nope-nope-nope', newPassword: 'brand-new-pass-1' });
    expect(wrong.statusCode).toBe(400);
    expect(wrong.json().error.fields.currentPassword).toBe('Неверный текущий пароль');
    const short = await h.req('POST', '/api/v1/auth/password', { currentPassword: 'correct-horse-1', newPassword: 'short' });
    expect(short.json().error.fields.newPassword).toBe('Пароль должен быть не короче 10 символов');

    const ok = await h.req('POST', '/api/v1/auth/password', { currentPassword: 'correct-horse-1', newPassword: 'brand-new-pass-1' });
    expect(ok.statusCode).toBe(204);
    expect((await h.req('GET', '/api/v1/auth/me')).statusCode).toBe(200);
    expect((await as(other, 'GET', '/api/v1/auth/me')).statusCode).toBe(401);
    await expect(loginAs(h.t, 'admin', 'correct-horse-1')).rejects.toThrow();
    await loginAs(h.t, 'admin', 'brand-new-pass-1');
    expect(h.auditCount('user', 'password_change')).toBe(1);
  });

  it('подбор текущего пароля ограничен: 6-я попытка — 429 (Review Focus 4)', async () => {
    h = await createApi();
    for (let i = 0; i < 5; i++) {
      expect((await h.req('POST', '/api/v1/auth/password', { currentPassword: `wrong-${i}-xxxxx`, newPassword: 'brand-new-pass-1' })).statusCode).toBe(400);
    }
    const blocked = await h.req('POST', '/api/v1/auth/password', { currentPassword: 'correct-horse-1', newPassword: 'brand-new-pass-1' });
    expect(blocked.statusCode).toBe(429);
    await loginAs(h.t, 'admin', 'correct-horse-1'); // пароль не сменился
  });

  it('успешная смена пароля сбрасывает счётчик неудач: после 4 промахов и смены ещё два промаха — 400, не 429', async () => {
    h = await createApi();
    const attempt = (currentPassword: string) =>
      h.req('POST', '/api/v1/auth/password', { currentPassword, newPassword: 'brand-new-pass-1' });
    for (let i = 0; i < 4; i++) expect((await attempt(`wrong-${i}-xxxxx`)).statusCode).toBe(400);
    expect((await attempt('correct-horse-1')).statusCode).toBe(204);
    // без сброса пятый промах уже исчерпал бы лимит, а шестая попытка получила бы 429
    expect((await attempt('wrong-a-xxxxx')).statusCode).toBe(400);
    expect((await attempt('wrong-b-xxxxx')).statusCode).toBe(400);
  });
});
