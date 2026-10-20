import { afterEach, describe, expect, it } from 'vitest';
import { createApi, type ApiHarness } from '../helpers/api';
import { loginAs, ORIGIN_HEADERS } from '../helpers/test-app';

let h: ApiHarness;
afterEach(async () => h?.t.cleanup());

describe('preferences API', () => {
  it('сохраняет любые JSON-значения и перезаписывает их; у каждого пользователя свои', async () => {
    h = await createApi();
    for (const [key, value] of [
      ['lastCompanyId', 7],
      ['journal.columns', ['date', 'amount']],
      ['sidebar', { collapsed: true }],
      ['empty', null],
    ] as const) {
      const res = await h.req('PUT', `/api/v1/preferences/${key}`, { value });
      expect(res.json()).toEqual({ key, value });
    }
    await h.req('PUT', '/api/v1/preferences/lastCompanyId', { value: 8 });
    expect((await h.req('GET', '/api/v1/preferences')).json().preferences).toEqual({
      lastCompanyId: 8,
      'journal.columns': ['date', 'amount'],
      sidebar: { collapsed: true },
      empty: null,
    });

    await h.req('POST', '/api/v1/users', { login: 'kassir', name: 'Кассир', password: 'kassir-pass-1' });
    const other = await loginAs(h.t, 'kassir', 'kassir-pass-1');
    const res = await h.t.app.inject({ method: 'GET', url: '/api/v1/preferences', headers: { ...ORIGIN_HEADERS, cookie: other } });
    expect(res.json().preferences).toEqual({});
  });

  it('проверки: ключ, отсутствующее и слишком большое значение, лимит числа ключей; история не пишется', async () => {
    h = await createApi();
    expect((await h.req('PUT', '/api/v1/preferences/1bad', { value: 1 })).json().error.fields.key).toBe('Недопустимый ключ');
    expect((await h.req('PUT', '/api/v1/preferences/ok', {})).json().error.fields.value).toBe('Укажите значение');
    const big = await h.req('PUT', '/api/v1/preferences/big', { value: 'x'.repeat(9000) });
    expect(big.json().error.fields.value).toBe('Слишком большое значение');
    // 5000 кириллических символов — 10 000 байт в UTF-8: лимит считается в байтах
    const cyr = await h.req('PUT', '/api/v1/preferences/cyr', { value: 'ж'.repeat(5000) });
    expect(cyr.json().error.fields.value).toBe('Слишком большое значение');
    for (let i = 0; i < 50; i++) await h.req('PUT', `/api/v1/preferences/k${i}`, { value: i });
    const over = await h.req('PUT', '/api/v1/preferences/k50', { value: 1 });
    expect(over.statusCode).toBe(400);
    expect(over.json().error.fields.key).toBe('Слишком много настроек');
    expect((await h.req('PUT', '/api/v1/preferences/k0', { value: 'обновление' })).statusCode).toBe(200); // существующий ключ можно
    expect(await h.auditCount('preference')).toBe(0);
  });
});
