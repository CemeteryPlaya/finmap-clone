import { afterEach, describe, expect, it } from 'vitest';
import { createTestApp, seedUser, type TestApp } from '../helpers/test-app';

let t: TestApp;
afterEach(async () => t?.cleanup());

const login = (headers: Record<string, string>) =>
  t.app.inject({ method: 'POST', url: '/api/v1/auth/login', headers, payload: { login: 'admin', password: 'correct-horse-1' } });

describe('CSRF', () => {
  it('отклоняет POST без X-Requested-With', async () => {
    t = await createTestApp();
    await seedUser(t);
    const r = await login({ origin: 'http://localhost:3000' });
    expect(r.statusCode).toBe(403);
    expect(r.json().error.code).toBe('CSRF');
  });

  it('отклоняет чужой и отсутствующий Origin', async () => {
    t = await createTestApp();
    await seedUser(t);
    expect((await login({ origin: 'https://evil.example', 'x-requested-with': 'fetch' })).statusCode).toBe(403);
    expect((await login({ 'x-requested-with': 'fetch' })).statusCode).toBe(403);
  });

  it('пропускает PUBLIC_URL, localhost, 127.0.0.1 и EXTRA_ORIGINS', async () => {
    t = await createTestApp({ PUBLIC_URL: 'https://fin.example.kz', EXTRA_ORIGINS: 'http://192.168.1.10:3000' });
    await seedUser(t);
    for (const origin of ['https://fin.example.kz', 'http://localhost:3000', 'http://127.0.0.1:3000', 'http://192.168.1.10:3000']) {
      expect((await login({ origin, 'x-requested-with': 'fetch' })).statusCode).toBe(200);
    }
  });

  it('GET не требует CSRF-заголовков', async () => {
    t = await createTestApp();
    expect((await t.app.inject({ method: 'GET', url: '/api/v1/health' })).statusCode).toBe(200);
  });

  it('percent-encoded путь (/%61pi/...) не обходит CSRF-защиту', async () => {
    t = await createTestApp();
    await seedUser(t);
    const r = await t.app.inject({
      method: 'POST',
      url: '/%61pi/v1/auth/login',
      payload: { login: 'admin', password: 'correct-horse-1' },
    });
    expect(r.statusCode).toBe(403);
    expect(r.json().error.code).toBe('CSRF');
  });
});
