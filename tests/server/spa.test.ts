import fs from 'node:fs';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { buildApp } from '../../src/server/app';
import { createTestDb } from '../helpers/test-db';
import { testConfig } from '../helpers/test-app';

let cleanup: (() => Promise<void>) | null = null;
afterEach(async () => cleanup?.());

describe('SPA', () => {
  it('отдаёт index.html для клиентских маршрутов и JSON 404 для /api', async () => {
    const t = createTestDb();
    const clientDir = path.join(t.dir, 'client');
    fs.mkdirSync(path.join(clientDir, 'assets'), { recursive: true });
    fs.writeFileSync(path.join(clientDir, 'index.html'), '<!doctype html><title>SPA</title>');
    fs.writeFileSync(path.join(clientDir, 'assets', 'app.js'), 'console.log(1)');
    const app = await buildApp({ config: testConfig(t.dir), db: t.db, sqlite: t.sqlite, clientDir });
    cleanup = async () => {
      await app.close();
      t.cleanup();
    };

    const page = await app.inject({ method: 'GET', url: '/c/1/log' });
    expect(page.statusCode).toBe(200);
    expect(page.body).toContain('<title>SPA</title>');

    const asset = await app.inject({ method: 'GET', url: '/assets/app.js' });
    expect(asset.body).toBe('console.log(1)');

    const api = await app.inject({ method: 'GET', url: '/api/v1/nope' });
    expect(api.statusCode).toBe(404);
    expect(api.json().error.code).toBe('NOT_FOUND');
  });
});
