import crypto from 'node:crypto';
import type { FastifyReply } from 'fastify';
import type { FileStore } from '../files/store';
import { contentDisposition } from './content-disposition';
import { XLSX_MIME } from './xlsx';

/** Ответ функции Vercel — не больше 4,5 МБ; файл больше 4 МБ туда не кладётся (план 2026-10-20-vercel-postgres, Р11). */
export const INLINE_MAX_BYTES = 4 * 1024 * 1024;

/** Куда деваются большие выгрузки: store — хранилище со ссылками (режим vercel), иначе null — всегда в ответе. */
export interface Downloads {
  store: FileStore | null;
  inlineMax: number;
}

export const inlineDownloads: Downloads = { store: null, inlineMax: INLINE_MAX_BYTES };

/**
 * Файл выгрузки — ссылка без побочных эффектов: в ответе «как файл», без кэша у посредников. В режиме vercel файл больше
 * предела кладётся в хранилище под exports/ (ежедневное задание чистит их через сутки), ответ — 302 на подписанную ссылку.
 */
export async function sendFile(reply: FastifyReply, file: { fileName: string; data: Buffer }, downloads: Downloads, contentType = XLSX_MIME): Promise<FastifyReply> {
  reply.header('Cache-Control', 'private, no-store');
  if (downloads.store && file.data.length > downloads.inlineMax) {
    const key = `exports/${crypto.randomUUID()}/${file.fileName.replace(/[/\\]/g, '_')}`;
    await downloads.store.put(key, file.data, contentType);
    const link = await downloads.store.downloadUrl(key);
    // ссылка — в заголовок Location: путь с кириллицей имени файла — в процентной записи
    if (link) return reply.redirect(new URL(link).href, 302);
  }
  reply.header('Content-Type', contentType);
  reply.header('Content-Disposition', contentDisposition(file.fileName));
  reply.header('X-Content-Type-Options', 'nosniff');
  return reply.send(file.data);
}
