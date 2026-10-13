import { afterEach, describe, expect, it, vi } from 'vitest';
import { commitImport, previewImport, uploadImport } from '../../src/client/lib/import-panel';
import type { AccountMapping, ImportPreview } from '../../src/shared/schemas/imports';

interface Call {
  url: string;
  init: RequestInit & { headers: Record<string, string> };
}

function mockFetch(): Call[] {
  const calls: Call[] = [];
  vi.stubGlobal('fetch', async (url: string, init: Call['init']) => {
    calls.push({ url, init });
    return new Response(JSON.stringify({ ok: true }), { status: 200 });
  });
  return calls;
}

afterEach(() => vi.unstubAllGlobals());

const mapping: AccountMapping = { key: 'касса', kind: 'existing', accountId: 7 };

describe('запросы панели импорта', () => {
  it('загрузка: байты файла телом, application/octet-stream и X-File-Name', async () => {
    const calls = mockFetch();
    const file = new File([new Uint8Array([1, 2, 3])], 'выгрузка 1.xlsx');
    await uploadImport(5, file);
    expect(calls).toHaveLength(1);
    expect(calls[0]!.url).toBe('/api/v1/companies/5/imports/upload');
    expect(calls[0]!.init.method).toBe('POST');
    expect(calls[0]!.init.headers['Content-Type']).toBe('application/octet-stream');
    expect(calls[0]!.init.headers['X-File-Name']).toBe(encodeURIComponent('выгрузка 1.xlsx'));
    expect(calls[0]!.init.body).toBe(file);
  });

  it('предпросмотр: JSON с токеном и сопоставлениями', async () => {
    const calls = mockFetch();
    await previewImport(5, 'a'.repeat(32), [mapping]);
    expect(calls[0]!.url).toBe('/api/v1/companies/5/imports/preview');
    expect(calls[0]!.init.method).toBe('POST');
    expect(calls[0]!.init.headers['Content-Type']).toBe('application/json');
    expect(JSON.parse(calls[0]!.init.body as string)).toEqual({ token: 'a'.repeat(32), accounts: [mapping] });
  });

  it('запись: в теле токен, сопоставления и revision показанной проверки', async () => {
    const calls = mockFetch();
    await commitImport(5, { token: 'b'.repeat(32), revision: '0123456789abcdef' } as ImportPreview, [mapping]);
    expect(calls[0]!.url).toBe('/api/v1/companies/5/imports');
    expect(calls[0]!.init.method).toBe('POST');
    expect(JSON.parse(calls[0]!.init.body as string)).toEqual({ token: 'b'.repeat(32), accounts: [mapping], revision: '0123456789abcdef' });
  });
});
