import { afterEach, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { AppError } from '../../src/server/errors';
import { createTestApp, type TestApp } from '../helpers/test-app';

let t: TestApp;
afterEach(async () => t?.cleanup());

describe('app', () => {
  it('GET /api/v1/health отвечает ok', async () => {
    t = await createTestApp();
    const res = await t.app.inject({ method: 'GET', url: '/api/v1/health' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true });
  });

  it('GET /api/v1/meta отдаёт название продукта', async () => {
    t = await createTestApp({ APP_NAME: 'Клубный учёт' });
    const res = await t.app.inject({ method: 'GET', url: '/api/v1/meta' });
    expect(res.json()).toEqual({ appName: 'Клубный учёт', timezone: 'Asia/Almaty', uploads: 'body' });
  });

  it('превращает AppError, ZodError и неизвестные ошибки в единый формат', async () => {
    t = await createTestApp({}, (app) => {
      app.get('/api/v1/__test/app-error', async () => {
        throw new AppError(422, 'INVARIANT_1', 'Сумма строк не равна сумме операции', { lines: 'не сходится' });
      });
      app.get('/api/v1/__test/zod', async () => z.object({ name: z.string().min(1) }).parse({ name: '' }));
      app.get('/api/v1/__test/crash', async () => {
        throw new Error('секретная деталь');
      });
    });

    const a = await t.app.inject({ method: 'GET', url: '/api/v1/__test/app-error' });
    expect(a.statusCode).toBe(422);
    expect(a.json()).toEqual({
      error: { code: 'INVARIANT_1', message: 'Сумма строк не равна сумме операции', fields: { lines: 'не сходится' } },
    });

    const z1 = await t.app.inject({ method: 'GET', url: '/api/v1/__test/zod' });
    expect(z1.statusCode).toBe(400);
    expect(z1.json().error.code).toBe('VALIDATION');
    expect(Object.keys(z1.json().error.fields)).toEqual(['name']);

    const c = await t.app.inject({ method: 'GET', url: '/api/v1/__test/crash' });
    expect(c.statusCode).toBe(500);
    expect(c.json()).toEqual({ error: { code: 'INTERNAL', message: 'Внутренняя ошибка сервера' } });
  });

  it('неизвестный /api путь даёт 404 в формате ошибки', async () => {
    t = await createTestApp();
    const res = await t.app.inject({ method: 'GET', url: '/api/v1/nope' });
    expect(res.statusCode).toBe(404);
    expect(res.json().error.code).toBe('NOT_FOUND');
  });
});
