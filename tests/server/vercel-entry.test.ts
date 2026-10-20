import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createServerlessApp, disposeServerlessApp, startupErrorApp } from '../../src/server/serverless';
import { pgSnapshot } from '../helpers/test-db';

/** Точка входа Vercel (план 2026-10-20-vercel-postgres, задача 13): приложение на уже размеченной базе, без миграций и блокировки. */

const ENV = {
  DEPLOY_MODE: 'vercel',
  SESSION_SECRET: 's'.repeat(40),
  DATABASE_URL: 'postgres://u:p@ep-x.eu-central-1.aws.neon.tech/neondb',
  CRON_SECRET: 'c'.repeat(16),
  BLOB_READ_WRITE_TOKEN: 'vercel_blob_rw_x',
  VERCEL_PROJECT_PRODUCTION_URL: 'finmap.vercel.app',
  RATES_SOURCE: 'fixtures',
};

afterEach(async () => disposeServerlessApp());

/** Имена в data/ (без чтения содержимого): точка входа не должна туда писать. */
const dataNames = () => {
  const dir = path.resolve('data');
  return fs.existsSync(dir) ? fs.readdirSync(dir).sort() : [];
};

describe('createServerlessApp', () => {
  it('отвечает /api/v1/health; одно приложение на экземпляр; интерфейс отдаёт сама функция; в data/ не пишет', async () => {
    const before = dataNames();
    // сборка интерфейса: у Fastify на Vercel статику из public/ CDN не отдаёт — её отдаёт функция из dist/client своего бандла
    const clientDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fc-client-'));
    fs.mkdirSync(path.join(clientDir, 'assets'));
    fs.writeFileSync(path.join(clientDir, 'index.html'), '<!doctype html><title>Учёт</title>');
    fs.writeFileSync(path.join(clientDir, 'assets', 'index-abc123.js'), 'console.log(1)');
    const db = { kind: 'pglite' as const, snapshot: await pgSnapshot() };
    const app = await createServerlessApp(ENV, { db, clientDir });
    expect(await createServerlessApp(ENV, { db, clientDir })).toBe(app);

    const health = await app.inject({ method: 'GET', url: '/api/v1/health' });
    expect([health.statusCode, health.json()]).toEqual([200, { ok: true }]);
    const meta = await app.inject({ method: 'GET', url: '/api/v1/meta' });
    expect(meta.json()).toMatchObject({ timezone: 'Asia/Almaty' });
    const page = await app.inject({ method: 'GET', url: '/c/1/journal' });
    expect([page.statusCode, page.headers['content-type']]).toEqual([200, 'text/html; charset=utf-8']);
    expect(page.body).toContain('<title>Учёт</title>');
    const asset = await app.inject({ method: 'GET', url: '/assets/index-abc123.js' });
    expect([asset.statusCode, asset.headers['cache-control']]).toEqual([200, 'public, max-age=31536000, immutable']);
    const api = await app.inject({ method: 'GET', url: '/api/v1/nope' });
    expect([api.statusCode, api.json().error.code]).toEqual([404, 'NOT_FOUND']);
    fs.rmSync(clientDir, { recursive: true, force: true });
    // CSRF: запись с адреса проекта разрешена (вход — 401 за неверный пароль, а не 403 за источник)
    const login = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      headers: { origin: 'https://finmap.vercel.app', 'x-requested-with': 'fetch' },
      payload: { login: 'nobody', password: 'wrong-password-1' },
    });
    expect(login.statusCode).toBe(401);
    expect(dataNames()).toEqual(before);
  });

  it('без DATABASE_URL Postgres — та же понятная ошибка конфигурации, приложение не создаётся', async () => {
    await expect(createServerlessApp({ ...ENV, DATABASE_URL: undefined })).rejects.toThrow('На Vercel нужен Postgres');
  });
});

describe('startupErrorApp', () => {
  it('приложение не запустилось — на любой адрес 503 с причиной: ошибка конфигурации называет переменную, прочие — без подробностей', async () => {
    const config = startupErrorApp(new Error('Ошибка конфигурации — CRON_SECRET обязателен в режиме vercel, не короче 16 символов'));
    const res = await config.inject({ method: 'GET', url: '/c/1/journal' });
    expect(res.statusCode).toBe(503);
    expect(res.json()).toEqual({ error: { code: 'STARTUP_FAILED', message: 'Ошибка конфигурации — CRON_SECRET обязателен в режиме vercel, не короче 16 символов' } });
    expect((await config.inject({ method: 'POST', url: '/api/v1/auth/login', payload: {} })).statusCode).toBe(503);
    await config.close();

    const other = startupErrorApp(new Error('connect ECONNREFUSED postgres://user:secret@host/db'));
    const body = (await other.inject({ method: 'GET', url: '/api/v1/health' })).json();
    expect(body.error.message).toBe('Сервер не запустился — причина в журнале Vercel (Logs)');
    expect(JSON.stringify(body)).not.toContain('secret');
    await other.close();
  });
});
