import { getPayloadFromClientToken } from '@vercel/blob/client';
import { afterEach, describe, expect, it } from 'vitest';
import type { FileStore, StoredFile } from '../../src/server/files/store';
import { createTestApp, loginAs, ORIGIN_HEADERS, seedUser, type TestApp } from '../helpers/test-app';

/**
 * Загрузка файлов прямо в Vercel Blob (план 2026-10-20-vercel-postgres, Р11, задача 14): токен клиентской загрузки
 * и вложение по ключу загруженного файла; скачивание — переход на подписанную ссылку.
 */

const VERCEL = {
  DEPLOY_MODE: 'vercel',
  DATABASE_URL: 'postgres://u:p@h/db',
  CRON_SECRET: 'c'.repeat(16),
  // формат настоящего токена: vercel_blob_rw_<id хранилища>_<секрет> — по нему подписывается токен клиента
  BLOB_READ_WRITE_TOKEN: 'vercel_blob_rw_StoreId123_secretsecretsecret',
  VERCEL_PROJECT_PRODUCTION_URL: 'finmap.vercel.app',
  // тесты входят с localhost (loginAs)
  EXTRA_ORIGINS: 'http://localhost:3000',
};
const HEADERS = ORIGIN_HEADERS;
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);

/** Хранилище в памяти со ссылками скачивания, как у Blob. */
function memoryStore() {
  const files = new Map<string, Buffer>();
  const store: FileStore = {
    async put(key, data) {
      files.set(key, data);
    },
    async get(key) {
      return files.get(key) ?? null;
    },
    async remove(key) {
      files.delete(key);
    },
    async list(prefix): Promise<StoredFile[]> {
      return [...files].filter(([k]) => k.startsWith(prefix)).map(([key, data]) => ({ key, size: data.length, uploadedAt: new Date() }));
    },
    async downloadUrl(key) {
      return `https://store.private.blob.vercel-storage.com/${key}?presign=1`;
    },
  };
  return { store, files };
}

let t: TestApp | null = null;
afterEach(async () => {
  await t?.cleanup();
  t = null;
});

async function world(overrides: Record<string, string> = VERCEL) {
  const mem = memoryStore();
  t = await createTestApp(overrides, undefined, undefined, { files: mem.store });
  await t.q("INSERT INTO currencies (code,name,symbol,minor_units) VALUES ('KZT','Тенге','₸',2)");
  await seedUser(t);
  const cookie = await loginAs(t);
  const req = (method: 'GET' | 'POST', url: string, payload?: object, withCookie = true) =>
    t!.app.inject({ method, url, headers: { ...HEADERS, ...(withCookie ? { cookie } : {}) }, ...(payload ? { payload } : {}) });
  const cid = (await req('POST', '/api/v1/companies', { name: 'ТОО' })).json().company.id as number;
  const account = (await req('POST', `/api/v1/companies/${cid}/accounts`, { name: 'Касса', currency: 'KZT', openedAt: '2026-10-01', startingBalance: 0 })).json().account.id;
  const op = (await req('POST', `/api/v1/companies/${cid}/operations`, { type: 'income', paidAt: '2026-10-05T10:00:00Z', accountId: account, amount: 100 })).json().operation.id as number;
  return { ...mem, req, cid, op };
}

describe('POST /api/v1/uploads/token', () => {
  it('токен на ключ uploads/<вид>/… с пределом размера вида; 11 МБ для вложения — 400; без входа — 401; локально — 404', async () => {
    const w = await world();
    const ok = await w.req('POST', '/api/v1/uploads/token', { kind: 'attachment', fileName: 'чек (1).PNG', size: 1000 });
    expect(ok.statusCode).toBe(200);
    const { pathname, token } = ok.json() as { pathname: string; token: string };
    expect(pathname).toMatch(/^uploads\/attachment\/[0-9a-f-]{36}\.png$/);
    const payload = getPayloadFromClientToken(token);
    expect(payload).toMatchObject({ pathname, maximumSizeInBytes: 10 * 1024 * 1024 });
    expect(payload.validUntil).toBeGreaterThan(Date.now());

    const imp = (await w.req('POST', '/api/v1/uploads/token', { kind: 'import', fileName: 'журнал.xlsx', size: 29 * 1024 * 1024 })).json();
    expect(imp.pathname).toMatch(/^uploads\/import\/[0-9a-f-]{36}\.xlsx$/);
    expect(getPayloadFromClientToken(imp.token).maximumSizeInBytes).toBe(30 * 1024 * 1024);

    const big = await w.req('POST', '/api/v1/uploads/token', { kind: 'attachment', fileName: 'скан.pdf', size: 11 * 1024 * 1024 });
    expect([big.statusCode, big.json().error.message]).toEqual([400, 'Проверьте файл']);
    expect(big.json().error.fields).toEqual({ size: 'Файл больше 10 МБ' });
    expect((await w.req('POST', '/api/v1/uploads/token', { kind: 'other', fileName: 'x', size: 1 })).statusCode).toBe(400);
    expect((await w.req('POST', '/api/v1/uploads/token', { kind: 'attachment', fileName: 'чек.png', size: 1 }, false)).statusCode).toBe(401);
  });

  it('вне Vercel файлы идут телом запроса — прямой загрузки нет', async () => {
    const w = await world({});
    expect((await w.req('POST', '/api/v1/uploads/token', { kind: 'attachment', fileName: 'чек.png', size: 1 })).statusCode).toBe(404);
    expect((await w.req('GET', '/api/v1/meta')).json()).toMatchObject({ uploads: 'body' });
  });
});

describe('вложение по ключу загруженного файла', () => {
  it('тип и размер — по содержимому из хранилища; скачивание — переход на подписанную ссылку; meta сообщает о прямой загрузке', async () => {
    const w = await world();
    expect((await w.req('GET', '/api/v1/meta')).json()).toMatchObject({ uploads: 'blob' });
    const { pathname } = (await w.req('POST', '/api/v1/uploads/token', { kind: 'attachment', fileName: 'чек.png', size: PNG.length })).json();
    w.files.set(pathname, PNG); // браузер загрузил файл в Blob
    const res = await w.req('POST', `/api/v1/companies/${w.cid}/operations/${w.op}/attachments`, { blobKey: pathname, fileName: 'чек (1).png' });
    expect(res.statusCode).toBe(201);
    const att = res.json().attachment;
    expect(att).toMatchObject({ operationId: w.op, originalName: 'чек (1).png', storedName: pathname, mime: 'image/png', size: PNG.length });

    const file = await w.req('GET', `/api/v1/companies/${w.cid}/attachments/${att.id}`);
    expect(file.statusCode).toBe(302);
    expect(file.headers.location).toBe(`https://store.private.blob.vercel-storage.com/${pathname}?presign=1`);
    expect(file.headers['cache-control']).toBe('private, no-store');

    // тот же ключ второй раз — нельзя: файл уже принадлежит вложению
    const again = await w.req('POST', `/api/v1/companies/${w.cid}/operations/${w.op}/attachments`, { blobKey: pathname, fileName: 'чек.png' });
    expect([again.statusCode, again.json().error.fields]).toEqual([400, { file: 'Файл не загружен — загрузите его снова' }]);
  });

  it('чужой ключ, незагруженный файл, недопустимый тип — 400; недопустимый файл удаляется из хранилища', async () => {
    const w = await world();
    const attach = (body: object) => w.req('POST', `/api/v1/companies/${w.cid}/operations/${w.op}/attachments`, body);
    w.files.set('backups/2026-10-01.json.gz', Buffer.from('секрет'));
    const foreign = await attach({ blobKey: 'backups/2026-10-01.json.gz', fileName: 'x.png' });
    expect([foreign.statusCode, foreign.json().error.fields]).toEqual([400, { file: 'Файл не загружен — загрузите его снова' }]);
    const missing = await attach({ blobKey: 'uploads/attachment/00000000-0000-4000-8000-000000000000.png', fileName: 'x.png' });
    expect(missing.statusCode).toBe(400);
    const html = 'uploads/attachment/11111111-1111-4111-8111-111111111111.png';
    w.files.set(html, Buffer.from('<html><script>alert(1)</script></html>'));
    const bad = await attach({ blobKey: html, fileName: 'чек.png' });
    expect([bad.statusCode, bad.json().error.fields.file]).toEqual([400, 'Допустимые файлы: PNG, JPG, WEBP, HEIC, PDF, XLSX, CSV']);
    expect(w.files.has(html)).toBe(false);
    expect(w.files.has('backups/2026-10-01.json.gz')).toBe(true);
    expect((await attach({ fileName: 'x.png' })).statusCode).toBe(400);
  });
});
