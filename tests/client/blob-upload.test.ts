import { afterEach, describe, expect, it, vi } from 'vitest';

/** Загрузка вложения на Vercel (план 2026-10-20-vercel-postgres, Р11): токен → файл прямо в Blob → вложение по ключу. */

const put = vi.fn();
vi.mock('@vercel/blob/client', () => ({ put }));

const { uploadAttachment } = await import('../../src/client/lib/attachments');
const { ApiError } = await import('../../src/client/lib/api');
const { queryClient } = await import('../../src/client/lib/query');

type Call = { url: string; method: string; body: unknown; contentType: string | null };

function serve(uploads: 'blob' | 'body') {
  const calls: Call[] = [];
  vi.stubGlobal('fetch', async (url: string, init: RequestInit = {}) => {
    const headers = new Headers(init.headers);
    const body = typeof init.body === 'string' ? JSON.parse(init.body) : init.body;
    calls.push({ url, method: init.method ?? 'GET', body, contentType: headers.get('content-type') });
    const json = (status: number, data: unknown) => new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json' } });
    if (url === '/api/v1/meta') return json(200, { appName: 'Учёт', timezone: 'Asia/Almaty', uploads });
    if (url === '/api/v1/uploads/token') return json(200, { pathname: 'uploads/attachment/u-1.png', token: 'vercel_blob_client_x' });
    if (url.endsWith('/attachments')) return json(201, { attachment: { id: 5, originalName: 'чек.png' } });
    return json(404, { error: { code: 'NOT_FOUND', message: 'Не найдено' } });
  });
  return calls;
}

afterEach(() => {
  vi.unstubAllGlobals();
  put.mockReset();
  queryClient.clear();
});

describe('uploadAttachment', () => {
  it('на Vercel: токен на файл, загрузка в Blob приватно, затем вложение по ключу — байты через функцию не идут', async () => {
    const calls = serve('blob');
    put.mockResolvedValue({ pathname: 'uploads/attachment/u-1.png' });
    const file = new File([new Uint8Array([1, 2, 3])], 'чек.png', { type: 'image/png' });
    const att = await uploadAttachment(3, 7, file);
    expect(att).toMatchObject({ id: 5 });
    expect(calls.filter((c) => c.url !== '/api/v1/meta').map((c) => [c.method, c.url, c.body])).toEqual([
      ['POST', '/api/v1/uploads/token', { kind: 'attachment', fileName: 'чек.png', size: 3 }],
      ['POST', '/api/v1/companies/3/operations/7/attachments', { blobKey: 'uploads/attachment/u-1.png', fileName: 'чек.png' }],
    ]);
    expect(put).toHaveBeenCalledWith('uploads/attachment/u-1.png', file, { access: 'private', token: 'vercel_blob_client_x', contentType: 'image/png', multipart: false });
  });

  it('сбой загрузки в Blob — понятная ошибка, вложение не создаётся', async () => {
    const calls = serve('blob');
    put.mockRejectedValue(new Error('network'));
    const err = await uploadAttachment(3, 7, new File(['x'], 'чек.png')).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect((err as InstanceType<typeof ApiError>).message).toBe('Не удалось загрузить файл — проверьте связь и попробуйте снова');
    expect(calls.some((c) => c.url.endsWith('/attachments'))).toBe(false);
  });

  it('локально — как раньше: байты телом запроса', async () => {
    const calls = serve('body');
    await uploadAttachment(3, 7, new File(['x'], 'чек.png'));
    const post = calls.find((c) => c.url.endsWith('/attachments'))!;
    expect(post.contentType).toBe('application/octet-stream');
    expect(put).not.toHaveBeenCalled();
  });
});
