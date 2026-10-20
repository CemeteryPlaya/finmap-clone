import zlib from 'node:zlib';
import { afterEach, describe, expect, it } from 'vitest';
import { VERCEL_ENV, vercelWorld, type VercelWorld } from '../helpers/vercel';

/**
 * Ежедневное задание Vercel (план 2026-10-20-vercel-postgres, Р13, задача 16): бэкап базы в хранилище, 14 последних,
 * уборка файлов загрузок и выгрузок старше суток и истёкших сессий. Экран «Резервное копирование» в режиме vercel.
 */

let w: VercelWorld | null = null;
afterEach(async () => {
  await w?.t.cleanup();
  w = null;
});

/** 23:00 UTC — 04:00 по Алматы следующего дня (расписание vercel.json). */
const NOW = new Date('2026-10-20T23:00:00.000Z');
const HOUR = 3600_000;
const cron = (v: VercelWorld, authorization?: string) =>
  v.t.app.inject({ method: 'GET', url: '/api/v1/cron/daily', headers: authorization ? { authorization } : {} });

describe('GET /api/v1/cron/daily', () => {
  it('без Bearer CRON_SECRET — 401, ничего не делается', async () => {
    w = await vercelWorld(VERCEL_ENV, {}, NOW);
    for (const auth of [undefined, 'Bearer wrong-secret-wrong', `Basic ${'c'.repeat(16)}`, `Bearer ${'c'.repeat(15)}`]) {
      const res = await cron(w, auth);
      expect([res.statusCode, res.json().error.code], String(auth)).toEqual([401, 'UNAUTHORIZED']);
    }
    expect([...w.files.keys()].filter((k) => k.startsWith('backups/'))).toEqual([]);
  });

  it('бэкап за сегодня по Алматы, 14 последних; загрузки и выгрузки старше суток и истёкшие сессии удалены', async () => {
    w = await vercelWorld(VERCEL_ENV, {}, NOW);
    const v = w;
    for (let d = 1; d <= 16; d++) v.files.set(`backups/2026-10-${String(d).padStart(2, '0')}.json.gz`, Buffer.from('x'));
    const put = (key: string, hoursAgo: number) => {
      v.files.set(key, Buffer.from('f'));
      v.uploadedAt.set(key, new Date(NOW.getTime() - hoursAgo * HOUR));
    };
    put('uploads/import/old.xlsx', 25);
    put('uploads/import/' + 'a'.repeat(32) + '.json', 30);
    put('uploads/attachment/fresh.png', 1);
    put('attachments/11111111-1111-4111-8111-111111111111.png', 30 * 24); // вложение месячной давности — не уборка
    put('22222222-2222-4222-8222-222222222222.png', 30 * 24); // перенесённое db:to-pg --files
    put('exports/u1/журнал.xlsx', 25);
    put('exports/u2/журнал.xlsx', 2);
    await v.t.q("INSERT INTO sessions (token_hash, user_id, remember, created_at, expires_at, last_seen_at) VALUES ('old', 1, FALSE, 'x', '2026-10-20T10:00:00.000Z', 'x')");

    const res = await cron(v, `Bearer ${'c'.repeat(16)}`);
    expect(res.statusCode, res.body).toBe(200);
    expect(res.json()).toMatchObject({ backup: 'backups/2026-10-21.json.gz', removed: { backups: 3, uploads: 2, exports: 1, sessions: 1 } });

    const backups = [...v.files.keys()].filter((k) => k.startsWith('backups/')).sort();
    expect(backups).toHaveLength(14);
    expect(backups[0]).toBe('backups/2026-10-04.json.gz');
    expect(backups.at(-1)).toBe('backups/2026-10-21.json.gz');
    const dump = JSON.parse(zlib.gunzipSync(v.files.get('backups/2026-10-21.json.gz')!).toString('utf8'));
    expect(dump).toMatchObject({ format: 'finmap-clone-dump', createdAt: NOW.toISOString() });
    expect(dump.tables.companies).toHaveLength(1);
    expect([...v.files.keys()].filter((k) => !k.startsWith('backups/')).sort()).toEqual([
      '22222222-2222-4222-8222-222222222222.png',
      'attachments/11111111-1111-4111-8111-111111111111.png',
      'exports/u2/журнал.xlsx',
      'uploads/attachment/fresh.png',
    ]);
    expect((await v.t.q("SELECT token_hash AS h FROM sessions WHERE token_hash = 'old'")).length).toBe(0);
    expect((await v.t.q('SELECT COUNT(*) AS n FROM sessions'))[0]).toEqual({ n: 1 }); // сессия входа теста жива

    // экран «Резервное копирование»: последняя копия — из хранилища; «Скачать сейчас» — свежая выгрузка по ссылке
    const status = (await v.req('GET', '/api/v1/backup/status')).json();
    expect(status).toEqual({
      last: { file: '2026-10-21.json.gz', createdAt: expect.any(String), size: v.files.get('backups/2026-10-21.json.gz')!.length },
      copyDir: null,
      lastCopyError: null,
      storage: 'blob',
      keep: 14,
    });
    const download = await v.t.app.inject({ method: 'GET', url: '/api/v1/backup/download', headers: { cookie: v.cookie, 'x-requested-with': 'fetch' } });
    expect(download.statusCode).toBe(200);
    const link = download.json() as { url: string; fileName: string };
    expect(link.fileName).toBe('backup-20261021-040000.json.gz');
    const key = [...v.files.keys()].find((k) => k.startsWith('exports/') && k.endsWith(link.fileName))!;
    expect(link.url).toBe(new URL(`https://store.private.blob.vercel-storage.com/${key}?presign=1`).href);
  });

  it('вне Vercel задания нет; экран — копии на диске', async () => {
    w = await vercelWorld({}, {}, NOW);
    expect((await cron(w, `Bearer ${'c'.repeat(16)}`)).statusCode).toBe(404);
    expect((await w.req('GET', '/api/v1/backup/status')).json()).toMatchObject({ storage: 'disk', keep: 14 });
  });
});
