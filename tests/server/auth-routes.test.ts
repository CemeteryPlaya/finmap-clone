import { afterEach, describe, expect, it } from 'vitest';
import { createTestApp, loginAs, ORIGIN_HEADERS, seedUser, type TestApp } from '../helpers/test-app';

let t: TestApp;
afterEach(async () => t?.cleanup());

describe('auth routes', () => {
  it('вход ставит httpOnly-куку sid и /auth/me возвращает пользователя', async () => {
    t = await createTestApp();
    await seedUser(t);
    const res = await t.app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      headers: ORIGIN_HEADERS,
      payload: { login: 'Admin', password: 'correct-horse-1' },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ user: { id: 1, login: 'admin', name: 'Тест' } });
    const c = res.cookies.find((x) => x.name === 'sid')!;
    expect(c.httpOnly).toBe(true);
    expect(c.sameSite).toBe('Lax');
    expect(c.secure).toBeFalsy(); // Review Focus 2: HTTP-запрос → без Secure
    expect(c.expires).toBeUndefined(); // без remember — сессионная кука

    const me = await t.app.inject({ method: 'GET', url: '/api/v1/auth/me', headers: { cookie: `sid=${c.value}` } });
    expect(me.json()).toEqual({ user: { id: 1, login: 'admin', name: 'Тест' } });
  });

  it('за прокси с X-Forwarded-Proto: https кука получает Secure; remember ставит срок', async () => {
    t = await createTestApp({ PUBLIC_URL: 'https://fin.example.kz' });
    await seedUser(t);
    const res = await t.app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      headers: { origin: 'https://fin.example.kz', 'x-requested-with': 'fetch', 'x-forwarded-proto': 'https' },
      payload: { login: 'admin', password: 'correct-horse-1', remember: true },
    });
    const c = res.cookies.find((x) => x.name === 'sid')!;
    expect(c.secure).toBe(true);
    expect(c.expires).toBeInstanceOf(Date);
  });

  it('неверный пароль → 401, после 5 неудач → 429 даже с верным паролем', async () => {
    t = await createTestApp();
    await seedUser(t);
    const attempt = (password: string) =>
      t.app.inject({ method: 'POST', url: '/api/v1/auth/login', headers: ORIGIN_HEADERS, payload: { login: 'admin', password } });
    for (let i = 0; i < 5; i++) {
      const r = await attempt('wrong-password');
      expect(r.statusCode).toBe(401);
      expect(r.json().error.code).toBe('INVALID_CREDENTIALS');
    }
    const blocked = await attempt('correct-horse-1');
    expect(blocked.statusCode).toBe(429);
    expect(blocked.json().error.code).toBe('RATE_LIMITED');
  });

  it('без сессии, с подделанной или отозванной кукой → 401 (Review Focus 4)', async () => {
    t = await createTestApp();
    await seedUser(t);
    expect((await t.app.inject({ method: 'GET', url: '/api/v1/auth/me' })).statusCode).toBe(401);
    const forged = await t.app.inject({ method: 'GET', url: '/api/v1/auth/me', headers: { cookie: 'sid=abc.def' } });
    expect(forged.statusCode).toBe(401);
    expect(forged.json().error.code).toBe('UNAUTHORIZED');

    const cookie = await loginAs(t);
    t.sqlite.prepare('DELETE FROM sessions').run(); // как после восстановления бэкапа
    expect((await t.app.inject({ method: 'GET', url: '/api/v1/auth/me', headers: { cookie } })).statusCode).toBe(401);
  });

  it('выход удаляет сессию и пишет историю', async () => {
    t = await createTestApp();
    await seedUser(t);
    const cookie = await loginAs(t);
    const out = await t.app.inject({ method: 'POST', url: '/api/v1/auth/logout', headers: { ...ORIGIN_HEADERS, cookie } });
    expect(out.statusCode).toBe(204);
    expect((await t.app.inject({ method: 'GET', url: '/api/v1/auth/me', headers: { cookie } })).statusCode).toBe(401);
    const actions = t.sqlite.prepare('SELECT action FROM audit_log ORDER BY id').all() as { action: string }[];
    expect(actions.map((a) => a.action)).toEqual(['create', 'login', 'logout']);
  });

  it('health и meta доступны без входа', async () => {
    t = await createTestApp();
    expect((await t.app.inject({ method: 'GET', url: '/api/v1/health' })).statusCode).toBe(200);
    expect((await t.app.inject({ method: 'GET', url: '/api/v1/meta' })).statusCode).toBe(200);
  });
});
