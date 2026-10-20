import crypto from 'node:crypto';
import path from 'node:path';
import { generateClientTokenFromReadWriteToken } from '@vercel/blob/client';
import type { FastifyInstance } from 'fastify';
import { uploadTokenSchema, type UploadTokenResponse } from '../../../shared/schemas/uploads';
import { AppError } from '../../errors';
import { ATTACHMENT_MAX_BYTES } from '../attachments/service';
import { IMPORT_MAX_BYTES } from '../imports/read-file';

/** Предел размера и текст отказа по виду файла. */
const LIMITS = {
  attachment: { bytes: ATTACHMENT_MAX_BYTES, text: 'Файл больше 10 МБ' },
  import: { bytes: IMPORT_MAX_BYTES, text: 'Файл больше 30 МБ' },
} as const;
/** Срок токена: браузер начинает загрузку сразу после ответа. */
const TOKEN_TTL_MS = 10 * 60 * 1000;

/** Ключ нового файла: вид, случайное имя и расширение исходного (только латиница и цифры). */
export function uploadKey(kind: keyof typeof LIMITS, fileName: string): string {
  const ext = path.extname(fileName).toLowerCase();
  return `uploads/${kind}/${crypto.randomUUID()}${/^\.[a-z0-9]{1,8}$/.test(ext) ? ext : ''}`;
}

/**
 * POST /api/v1/uploads/token (план 2026-10-20-vercel-postgres, Р11): токен загрузки браузера прямо в Vercel Blob — только
 * для вошедшего пользователя (проверки сессии и CSRF общие), на один ключ, с пределом размера вида и сроком 10 минут.
 * Только в режиме vercel: тело запроса функции Vercel ограничено 4,5 МБ, а вложения — до 10 МБ, файлы импорта — до 30 МБ.
 */
export function registerUploadsRoutes(app: FastifyInstance, deps: { blobToken: string; now?: () => Date }): void {
  const now = deps.now ?? (() => new Date());
  app.post('/api/v1/uploads/token', async (req): Promise<UploadTokenResponse> => {
    const body = uploadTokenSchema.parse(req.body);
    const limit = LIMITS[body.kind];
    if (body.size > limit.bytes) throw new AppError(400, 'VALIDATION', 'Проверьте файл', { size: limit.text });
    const pathname = uploadKey(body.kind, body.fileName);
    const token = await generateClientTokenFromReadWriteToken({
      token: deps.blobToken,
      pathname,
      maximumSizeInBytes: limit.bytes,
      validUntil: now().getTime() + TOKEN_TTL_MS,
      allowOverwrite: false,
    });
    return { pathname, token };
  });
}
