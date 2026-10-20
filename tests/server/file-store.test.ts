import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createBlobStore, type BlobApi } from '../../src/server/files/blob';
import { createLocalStore } from '../../src/server/files/local';

/** Хранилище файлов (план 2026-10-20-vercel-postgres, Р10, задача 14): папка на диске локально, Vercel Blob на Vercel. */

let dir = '';
afterEach(() => {
  if (dir) fs.rmSync(dir, { recursive: true, force: true });
  dir = '';
});

describe('local', () => {
  it('put/get/list/remove в папке; ключ с подпапками; чужой путь — ошибка; ссылки скачивания нет', async () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fc-files-'));
    const store = createLocalStore(dir);
    await store.put('a.png', Buffer.from('A'), 'image/png');
    await store.put('backups/2026-10-01.json.gz', Buffer.from('B'), 'application/gzip');
    expect(fs.readFileSync(path.join(dir, 'a.png'), 'utf8')).toBe('A');
    expect((await store.get('backups/2026-10-01.json.gz'))?.toString()).toBe('B');
    expect(await store.get('нет.png')).toBeNull();
    const listed = await store.list('backups/');
    expect(listed.map((f) => [f.key, f.size])).toEqual([['backups/2026-10-01.json.gz', 1]]);
    expect(listed[0]!.uploadedAt).toBeInstanceOf(Date);
    expect((await store.list('')).map((f) => f.key).sort()).toEqual(['a.png', 'backups/2026-10-01.json.gz']);
    expect(await store.list('нет/')).toEqual([]);
    await store.remove('a.png');
    await store.remove('a.png'); // повторное удаление — не ошибка
    expect(fs.existsSync(path.join(dir, 'a.png'))).toBe(false);
    await expect(store.put('../x', Buffer.from('X'), 'text/plain')).rejects.toThrow('Недопустимый ключ файла');
    await expect(store.get('/etc/passwd')).rejects.toThrow('Недопустимый ключ файла');
    expect(await store.downloadUrl('backups/2026-10-01.json.gz')).toBeNull();
  });
});

/** Хранилище Blob в памяти: те же вызовы, что у @vercel/blob. */
function fakeBlobApi() {
  const files = new Map<string, { data: Buffer; contentType: string; uploadedAt: Date }>();
  const calls: string[] = [];
  const api: BlobApi = {
    async put(pathname, body, opts) {
      calls.push(`put ${pathname} ${opts.access} ${opts.token} ${opts.contentType} suffix=${opts.addRandomSuffix} overwrite=${opts.allowOverwrite}`);
      files.set(pathname, { data: Buffer.from(body), contentType: opts.contentType, uploadedAt: new Date('2026-10-20T00:00:00Z') });
    },
    async get(pathname, opts) {
      calls.push(`get ${pathname} ${opts.access}`);
      const f = files.get(pathname);
      if (!f) return null;
      return { statusCode: 200, stream: new Blob([new Uint8Array(f.data)]).stream() };
    },
    async del(pathname) {
      calls.push(`del ${pathname}`);
      files.delete(pathname);
    },
    async list(opts) {
      // по одной записи на страницу — проверка курсора
      const keys = [...files.keys()].filter((k) => k.startsWith(opts.prefix)).sort();
      const at = opts.cursor ? Number(opts.cursor) : 0;
      const page = keys.slice(at, at + 1);
      const hasMore = at + 1 < keys.length;
      return { blobs: page.map((k) => ({ pathname: k, size: files.get(k)!.data.length, uploadedAt: files.get(k)!.uploadedAt })), hasMore, cursor: hasMore ? String(at + 1) : undefined };
    },
    async issueSignedToken(opts) {
      calls.push(`sign ${opts.pathname} ${opts.operations.join(',')} ${opts.validUntil}`);
      return { clientSigningToken: 'cst', delegationToken: 'dt' };
    },
    async presignUrl(_token, opts) {
      return { presignedUrl: `https://store.private.blob.vercel-storage.com/${opts.pathname}?presign=1&until=${opts.validUntil}` };
    },
  };
  return { api, files, calls };
}

describe('blob', () => {
  it('приватные файлы без случайного суффикса; чтение в буфер; список по страницам; ссылка — подписанная на 5 минут', async () => {
    const { api, files, calls } = fakeBlobApi();
    const now = new Date('2026-10-20T10:00:00.000Z');
    const store = createBlobStore('vercel_blob_rw_store_secret', { api, now: () => now });
    await store.put('uploads/attachment/u1/чек.png', Buffer.from('PNG'), 'image/png');
    await store.put('backups/2026-10-01.json.gz', Buffer.from('B1'), 'application/gzip');
    await store.put('backups/2026-10-02.json.gz', Buffer.from('B22'), 'application/gzip');
    expect(calls[0]).toBe('put uploads/attachment/u1/чек.png private vercel_blob_rw_store_secret image/png suffix=false overwrite=true');
    expect((await store.get('uploads/attachment/u1/чек.png'))?.toString()).toBe('PNG');
    expect(await store.get('нет')).toBeNull();
    expect((await store.list('backups/')).map((f) => [f.key, f.size])).toEqual([
      ['backups/2026-10-01.json.gz', 2],
      ['backups/2026-10-02.json.gz', 3],
    ]);
    await store.remove('backups/2026-10-01.json.gz');
    expect([...files.keys()].sort()).toEqual(['backups/2026-10-02.json.gz', 'uploads/attachment/u1/чек.png']);
    const until = now.getTime() + 5 * 60 * 1000;
    expect(await store.downloadUrl('uploads/attachment/u1/чек.png')).toBe(`https://store.private.blob.vercel-storage.com/uploads/attachment/u1/чек.png?presign=1&until=${until}`);
    expect(calls).toContain(`sign uploads/attachment/u1/чек.png get ${until}`);
  });
});
