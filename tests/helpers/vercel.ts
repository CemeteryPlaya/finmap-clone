import type { LightMyRequestResponse } from 'fastify';
import type { AppDeps } from '../../src/server/app';
import type { FileStore, StoredFile } from '../../src/server/files/store';
import { createTestApp, loginAs, ORIGIN_HEADERS, seedUser, type TestApp } from './test-app';

/** Режим vercel в тестах (план 2026-10-20-vercel-postgres): переменные окружения и хранилище файлов в памяти. */
export const VERCEL_ENV = {
  DEPLOY_MODE: 'vercel',
  DATABASE_URL: 'postgres://u:p@h/db',
  CRON_SECRET: 'c'.repeat(16),
  // формат настоящего токена: vercel_blob_rw_<id хранилища>_<секрет> — по нему подписывается токен клиента
  BLOB_READ_WRITE_TOKEN: 'vercel_blob_rw_StoreId123_secretsecretsecret',
  VERCEL_PROJECT_PRODUCTION_URL: 'finmap.vercel.app',
  // тесты входят с localhost (loginAs)
  EXTRA_ORIGINS: 'http://localhost:3000',
};

/** Хранилище в памяти со ссылками скачивания, как у Blob. */
export function memoryStore() {
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
      return [...files]
        .filter(([k]) => k.startsWith(prefix))
        .sort(([a], [b]) => (a < b ? -1 : 1))
        .map(([key, data]) => ({ key, size: data.length, uploadedAt: new Date() }));
    },
    async downloadUrl(key) {
      return `https://store.private.blob.vercel-storage.com/${key}?presign=1`;
    },
  };
  return { store, files };
}

export interface VercelWorld {
  t: TestApp;
  files: Map<string, Buffer>;
  cookie: string;
  req(method: 'GET' | 'POST' | 'PATCH' | 'DELETE', url: string, payload?: object, withCookie?: boolean): Promise<LightMyRequestResponse>;
  cid: number;
  account: number;
  op: number;
}

/** Приложение в режиме vercel (или с env) с хранилищем в памяти, вошедшим admin, компанией, счётом KZT и операцией. */
export async function vercelWorld(env: Record<string, string> = VERCEL_ENV, deps: Pick<AppDeps, 'importCache' | 'exportInlineMaxBytes'> = {}): Promise<VercelWorld> {
  const mem = memoryStore();
  const t = await createTestApp(env, undefined, undefined, { files: mem.store, ...deps });
  await t.q("INSERT INTO currencies (code,name,symbol,minor_units) VALUES ('KZT','Тенге','₸',2)");
  await seedUser(t);
  const cookie = await loginAs(t);
  const req: VercelWorld['req'] = (method, url, payload, withCookie = true) =>
    t.app.inject({ method, url, headers: { ...ORIGIN_HEADERS, ...(withCookie ? { cookie } : {}) }, ...(payload ? { payload } : {}) });
  const cid = (await req('POST', '/api/v1/companies', { name: 'ТОО' })).json().company.id as number;
  const account = (await req('POST', `/api/v1/companies/${cid}/accounts`, { name: 'Касса', currency: 'KZT', openedAt: '2026-10-01', startingBalance: 0 })).json().account.id as number;
  const op = (await req('POST', `/api/v1/companies/${cid}/operations`, { type: 'income', paidAt: '2026-10-05T10:00:00Z', accountId: account, amount: 100 })).json().operation.id as number;
  return { t, files: mem.files, cookie, req, cid, account, op };
}
