import { del, get, issueSignedToken, list, presignUrl, put } from '@vercel/blob';
import { assertKey, type FileStore, type StoredFile } from './store';

/** Вызовы @vercel/blob, которыми пользуется хранилище (подменяются в тестах). */
export interface BlobApi {
  put(pathname: string, body: Buffer, opts: { access: 'private'; token: string; contentType: string; addRandomSuffix: false; allowOverwrite: true }): Promise<unknown>;
  get(pathname: string, opts: { access: 'private'; token: string; useCache: false }): Promise<{ statusCode: number; stream: ReadableStream<Uint8Array> | null } | null>;
  del(pathname: string, opts: { token: string }): Promise<void>;
  list(opts: { prefix: string; cursor?: string; token: string }): Promise<{ blobs: { pathname: string; size: number; uploadedAt: Date }[]; hasMore: boolean; cursor?: string }>;
  issueSignedToken(opts: { token: string; pathname: string; operations: ['get']; validUntil: number }): Promise<{ clientSigningToken: string; delegationToken: string }>;
  presignUrl(
    token: { clientSigningToken: string; delegationToken: string },
    opts: { operation: 'get'; access: 'private'; pathname: string; validUntil: number },
  ): Promise<{ presignedUrl: string }>;
}

const vercelBlob = { put, get, del, list, issueSignedToken, presignUrl } as unknown as BlobApi;

/** Срок подписанной ссылки скачивания. */
const LINK_TTL_MS = 5 * 60 * 1000;

/**
 * Приватное хранилище Vercel Blob (режим vercel): файлы без случайного суффикса (ключ задаёт приложение), читаются
 * только с токеном; скачивание — подписанная ссылка на 5 минут, выданная после проверки сессии.
 */
export function createBlobStore(token: string, opts: { api?: BlobApi; now?: () => Date } = {}): FileStore {
  const api = opts.api ?? vercelBlob;
  const now = opts.now ?? (() => new Date());
  return {
    async put(key, data, contentType) {
      assertKey(key);
      await api.put(key, data, { access: 'private', token, contentType, addRandomSuffix: false, allowOverwrite: true });
    },
    async get(key) {
      assertKey(key);
      const res = await api.get(key, { access: 'private', token, useCache: false });
      if (!res || res.statusCode !== 200 || !res.stream) return null;
      return Buffer.from(await new Response(res.stream).arrayBuffer());
    },
    async remove(key) {
      assertKey(key);
      await api.del(key, { token });
    },
    async list(prefix) {
      const out: StoredFile[] = [];
      let cursor: string | undefined;
      do {
        const page = await api.list({ prefix, cursor, token });
        for (const b of page.blobs) out.push({ key: b.pathname, size: b.size, uploadedAt: new Date(b.uploadedAt) });
        cursor = page.hasMore ? page.cursor : undefined;
      } while (cursor);
      return out.sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
    },
    async downloadUrl(key) {
      assertKey(key);
      const validUntil = now().getTime() + LINK_TTL_MS;
      const signed = await api.issueSignedToken({ token, pathname: key, operations: ['get'], validUntil });
      return (await api.presignUrl(signed, { operation: 'get', access: 'private', pathname: key, validUntil })).presignedUrl;
    },
  };
}
