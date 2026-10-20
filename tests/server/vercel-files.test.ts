import { afterEach, describe, expect, it } from 'vitest';
import { createImportCache, type ImportCache } from '../../src/server/modules/imports/cache';
import type { ImportCommitResult, ImportPreview } from '../../src/shared/schemas/imports';
import { excelSerial as at, finmapLikeRow as fr, finmapLikeXlsx } from '../helpers/finmap-like';
import { VERCEL_ENV, vercelWorld, type VercelWorld } from '../helpers/vercel';

/**
 * Импорт и выгрузки на Vercel (план 2026-10-20-vercel-postgres, задача 15, Review Focus 4 и 5): файл импорта — в Blob,
 * проверка переживает другой экземпляр функции; выгрузка больше 4 МБ — через хранилище и подписанную ссылку.
 */

let w: VercelWorld | null = null;
afterEach(async () => {
  await w?.t.cleanup();
  w = null;
});

const FILE = finmapLikeXlsx([
  fr({ paidAt: at('2026-10-03', '22:07:00'), amount: 10596, to: 'Касса', category: 'Бар' }),
  fr({ paidAt: at('2026-10-04', '09:15:00'), amount: 500, from: 'Касса', category: 'Аренда' }),
]);

/** Файл, загруженный браузером в Blob по токену (POST /uploads/token). */
async function uploaded(v: VercelWorld, data: Buffer, fileName = 'выгрузка.xlsx'): Promise<string> {
  const res = await v.req('POST', '/api/v1/uploads/token', { kind: 'import', fileName, size: data.length });
  const { pathname } = res.json() as { pathname: string };
  v.files.set(pathname, data);
  return pathname;
}

describe('импорт по ключу файла в хранилище (Review Focus 4)', () => {
  it('проверка и запись по токену работают и после промаха кэша (другой экземпляр); после записи файл удалён, повтор — 410', async () => {
    let cache: ImportCache = createImportCache();
    w = await vercelWorld(VERCEL_ENV, { importCache: { put: (i, t) => cache.put(i, t), get: (...a) => cache.get(...a), remove: (t) => cache.remove(t), size: () => cache.size() } });
    const v = w;
    const base = `/api/v1/companies/${v.cid}/imports`;
    const blobKey = await uploaded(v, FILE);
    const up = await v.req('POST', `${base}/upload`, { blobKey, fileName: 'выгрузка.xlsx' });
    expect(up.statusCode, up.body).toBe(200);
    const first = up.json() as ImportPreview;
    expect(first.file).toEqual({ name: 'выгрузка.xlsx', size: FILE.length, rows: 2 });

    cache = createImportCache(); // другой экземпляр: кэш пуст
    const again = await v.req('POST', `${base}/preview`, { token: first.token, accounts: [] });
    expect(again.statusCode, again.body).toBe(200);
    expect(again.json()).toEqual(first);

    cache = createImportCache();
    const commit = await v.req('POST', base, { token: first.token, accounts: [], revision: first.revision });
    expect(commit.statusCode, commit.body).toBe(201);
    expect((commit.json() as ImportCommitResult).counts).toMatchObject({ rows: 2, added: 2 });
    expect([...v.files.keys()].filter((k) => k.startsWith('uploads/import/'))).toEqual([]);

    cache = createImportCache();
    const repeat = await v.req('POST', base, { token: first.token, accounts: [], revision: first.revision });
    expect([repeat.statusCode, repeat.json().error.code]).toEqual([410, 'IMPORT_EXPIRED']);
  });

  it('проверка привязана к компании и пользователю и после промаха кэша; чужой ключ и незагруженный файл — 400', async () => {
    let cache: ImportCache = createImportCache();
    w = await vercelWorld(VERCEL_ENV, { importCache: { put: (i, t) => cache.put(i, t), get: (...a) => cache.get(...a), remove: (t) => cache.remove(t), size: () => cache.size() } });
    const v = w;
    const other = (await v.req('POST', '/api/v1/companies', { name: 'Другая' })).json().company.id as number;
    const up = (await v.req('POST', `/api/v1/companies/${v.cid}/imports/upload`, { blobKey: await uploaded(v, FILE), fileName: 'выгрузка.xlsx' })).json() as ImportPreview;
    cache = createImportCache();
    const foreign = await v.req('POST', `/api/v1/companies/${other}/imports/preview`, { token: up.token, accounts: [] });
    expect([foreign.statusCode, foreign.json().error.code]).toEqual([410, 'IMPORT_EXPIRED']);

    v.files.set('backups/2026-10-01.json.gz', FILE);
    const wrong = await v.req('POST', `/api/v1/companies/${v.cid}/imports/upload`, { blobKey: 'backups/2026-10-01.json.gz', fileName: 'x.xlsx' });
    expect([wrong.statusCode, wrong.json().error.fields]).toEqual([400, { file: 'Файл не загружен — загрузите его снова' }]);
    const missing = await v.req('POST', `/api/v1/companies/${v.cid}/imports/upload`, { blobKey: 'uploads/import/00000000-0000-4000-8000-000000000000.xlsx', fileName: 'x.xlsx' });
    expect(missing.statusCode).toBe(400);
  });
});

describe('большие выгрузки (Review Focus 5)', () => {
  it('на Vercel файл больше предела ответа — в хранилище под exports/ и переход 302 на подписанную ссылку; меньше — как раньше', async () => {
    // предел ответа функции — 4,5 МБ; в тесте он снижен, чтобы не собирать мегабайты
    w = await vercelWorld(VERCEL_ENV, { exportInlineMaxBytes: 2000 });
    const v = w;
    const big = await v.req('GET', `/api/v1/companies/${v.cid}/operations/export.xlsx?format=finmap`);
    expect(big.statusCode).toBe(302);
    const exported = [...v.files.keys()].filter((k) => k.startsWith('exports/'));
    expect(exported).toHaveLength(1);
    expect(exported[0]).toMatch(/^exports\/[0-9a-f-]{36}\/.+\.xlsx$/);
    expect(big.headers.location).toBe(new URL(`https://store.private.blob.vercel-storage.com/${exported[0]}?presign=1`).href);
    expect(big.headers['cache-control']).toBe('private, no-store');
    expect(v.files.get(exported[0]!)!.subarray(0, 2).toString()).toBe('PK');

    const report = await v.req('GET', `/api/v1/companies/${v.cid}/analytics/cashflow.xlsx?from=2026-10-01&to=2026-10-31&step=month`);
    // любой файл Excel больше 2000 байт: отчёты идут тем же путём
    expect(report.statusCode).toBe(302);
    expect([...v.files.keys()].filter((k) => k.startsWith('exports/'))).toHaveLength(2);
  });

  it('вне Vercel выгрузка всегда в ответе, как раньше', async () => {
    w = await vercelWorld({}, { exportInlineMaxBytes: 2000 });
    const res = await w.req('GET', `/api/v1/companies/${w.cid}/operations/export.xlsx?format=finmap`);
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toBe('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    expect([...w.files.keys()].filter((k) => k.startsWith('exports/'))).toEqual([]);
  });
});
