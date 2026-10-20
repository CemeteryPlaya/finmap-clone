import type { UploadTokenResponse } from '../../shared/schemas/uploads';
import { api, ApiError } from './api';
import { queryClient } from './query';

/** Как сервер принимает файлы (`/meta`): телом запроса (локально) или прямой загрузкой в Vercel Blob. */
export type UploadMode = 'body' | 'blob';

/** Способ загрузки из `/meta` (кэш запроса meta интерфейса). */
export async function uploadMode(): Promise<UploadMode> {
  const meta = await queryClient.fetchQuery({ queryKey: ['meta'], queryFn: () => api<{ uploads?: UploadMode }>('/meta'), staleTime: Infinity });
  return meta.uploads ?? 'body';
}

/** Файл больше этого — частями (multipart Vercel Blob переживает обрыв одной части). */
const MULTIPART_FROM = 5 * 1024 * 1024;

/**
 * Загрузка в Vercel Blob (план 2026-10-20-vercel-postgres, Р11): сервер выдаёт токен на один ключ после проверки
 * сессии, браузер грузит файл прямо в хранилище; возвращает ключ — его получает сервер вместо байтов.
 */
export async function uploadToBlob(kind: 'attachment' | 'import', file: File): Promise<string> {
  const { pathname, token } = await api<UploadTokenResponse>('/uploads/token', { method: 'POST', body: { kind, fileName: file.name, size: file.size } });
  const { put } = await import('@vercel/blob/client');
  try {
    await put(pathname, file, { access: 'private', token, contentType: file.type || undefined, multipart: file.size > MULTIPART_FROM });
  } catch {
    throw new ApiError(0, 'NETWORK', 'Не удалось загрузить файл — проверьте связь и попробуйте снова');
  }
  return pathname;
}
