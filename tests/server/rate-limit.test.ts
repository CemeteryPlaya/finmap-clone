import { afterEach, describe, expect, it } from 'vitest';
import { createTestApp, loginAs, seedUser, type TestApp } from '../helpers/test-app';

let t: TestApp;
afterEach(async () => t?.cleanup());

describe('лимит API и заголовки', () => {
  it('301-й запрос сессии за минуту получает 429', async () => {
    t = await createTestApp();
    await seedUser(t);
    const cookie = await loginAs(t);
    let last = 0;
    for (let i = 0; i < 301; i++) {
      last = (await t.app.inject({ method: 'GET', url: '/api/v1/auth/me', headers: { cookie } })).statusCode;
    }
    expect(last).toBe(429);
  });

  it('helmet ставит защитные заголовки', async () => {
    t = await createTestApp();
    const res = await t.app.inject({ method: 'GET', url: '/api/v1/health' });
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['content-security-policy']).toContain("default-src 'self'");
  });
});
