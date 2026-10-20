import { z } from 'zod';

/** Прямая загрузка в Vercel Blob (план 2026-10-20-vercel-postgres, Р11): запрос токена клиентской загрузки. */
export const uploadTokenSchema = z.object({
  kind: z.enum(['attachment', 'import']),
  fileName: z.string().min(1).max(200),
  size: z.number().int().min(1),
});
export type UploadTokenRequest = z.infer<typeof uploadTokenSchema>;
export interface UploadTokenResponse {
  /** Ключ файла в хранилище: его браузер передаёт в put и затем серверу. */
  pathname: string;
  token: string;
}

/** Вложение по ключу файла, уже загруженного в хранилище. */
export const storedAttachmentSchema = z.object({ blobKey: z.string().min(1).max(300), fileName: z.string().min(1).max(200) });
