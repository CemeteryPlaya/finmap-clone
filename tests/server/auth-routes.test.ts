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

  it('одновременная серия неверных паролей не обходит лимит попыток', async () => {
    t = await createTestApp();
    await seedUser(t);
    const attempt = (password: string) =>
      t.app.inject({ method: 'POST', url: '/api/v1/auth/login', headers: ORIGIN_HEADERS, payload: { login: 'admin', password } });
    const results = await Promise.all(Array.from({ length: 10 }, () => attempt('wrong-password')));
    const codes = results.map((r) => r.statusCode);
    expect(codes.filter((c) => c === 401).length).toBeLessThanOrEqual(5);
    expect(codes.filter((c) => c !== 401 && c !== 429)).toEqual([]);
    expect(codes.filter((c) => c === 429).length).toBe(10 - codes.filter((c) => c === 401).length);
    const after = await attempt('correct-horse-1');
    expect(after.statusCode).toBe(429);
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

  it('закодированный путь /%61pi/... не обходит проверку входа', async () => {
    t = await createTestApp();
    await seedUser(t);
    const me = await t.app.inject({ method: 'GET', url: '/%61pi/v1/auth/me' });
    expect(me.statusCode).toBe(401);
    expect(me.json().error.code).toBe('UNAUTHORIZED');
    const out = await t.app.inject({ method: 'POST', url: '/%61pi/v1/auth/logout', headers: ORIGIN_HEADERS });
    expect(out.statusCode).toBe(401);
  });

  it('remember-вход продолжает работать, кука перевыставляется только при продлении', async () => {
    t = await createTestApp();
    await seedUser(t);
    const login = await t.app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      headers: ORIGIN_HEADERS,
      payload: { login: 'admin', password: 'correct-horse-1', remember: true },
    });
    const c = login.cookies.find((x) => x.name === 'sid')!;
    const me = await t.app.inject({ method: 'GET', url: '/api/v1/auth/me', headers: { cookie: `sid=${c.value}` } });
    expect(me.statusCode).toBe(200);
    expect(me.headers['set-cookie']).toBeUndefined();
  });

  it('успешный вход не обнуляет счётчик IP', async () => {
    t = await createTestApp();
    await seedUser(t, 'alice');
    await seedUser(t, 'bob');
    const attempt = (login: string, password: string) =>
      t.app.inject({ method: 'POST', url: '/api/v1/auth/login', headers: ORIGIN_HEADERS, payload: { login, password } });
    for (let i = 0; i < 4; i++) expect((await attempt('alice', 'wrong-password')).statusCode).toBe(401);
    expect((await attempt('bob', 'correct-horse-1')).statusCode).toBe(200);
    expect((await attempt('alice', 'wrong-password')).statusCode).toBe(401);
    expect((await attempt('carol', 'whatever')).statusCode).toBe(429);
  });
});
