import { useQuery } from '@tanstack/react-query';
import { api, ApiError } from './api';
import { uploadMode, uploadToBlob } from './blob-upload';
import { queryClient } from './query';

/** Вложение операции (`GET …/operations/:id/attachments`, план 4b). */
export interface Attachment {
  id: number;
  companyId: number;
  operationId: number;
  originalName: string;
  storedName: string;
  mime: string;
  size: number;
  createdAt: string;
  deletedAt: string | null;
}

/** §8: не больше 10 МБ — проверяется до отправки, чтобы не гнать лишние байты. Тип проверяет сервер по содержимому. */
export const ATTACHMENT_MAX_BYTES = 10 * 1024 * 1024;
/** Подсказка выбора файла (§8): png, jpg, webp, heic, pdf, xlsx, csv. */
export const ATTACHMENT_ACCEPT = '.png,.jpg,.jpeg,.webp,.heic,.heif,.pdf,.xlsx,.csv';

/**
 * Ошибка типа до загрузки (по расширению из ATTACHMENT_ACCEPT, как в окне выбора файла); null — тип допустим.
 * Файл без расширения пропускается: тип по содержимому определяет сервер. Неизвестное расширение — отказ.
 */
export function attachmentTypeError(name: string): string | null {
  const dot = name.lastIndexOf('.');
  if (dot < 0) return null;
  const ext = name.slice(dot).toLowerCase();
  return ATTACHMENT_ACCEPT.split(',').includes(ext) ? null : 'Допустимые файлы: PNG, JPG, WEBP, HEIC, PDF, XLSX, CSV';
}

/** Ошибка размера до загрузки; null — размер подходит. */
export function attachmentSizeError(size: number): string | null {
  if (size === 0) return 'Файл пустой';
  if (size > ATTACHMENT_MAX_BYTES) return 'Файл больше 10 МБ';
  return null;
}

/** «512 Б», «12 КБ», «1,5 МБ». */
export function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} Б`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} КБ`;
  return `${(Math.round((bytes / 1024 / 1024) * 10) / 10).toString().replace('.', ',')} МБ`;
}

/** Текст ошибки загрузки: тип файла и пустой файл — в `fields`, остальное — в сообщении. */
export function uploadErrorText(e: unknown): string {
  if (!(e instanceof ApiError)) return 'Ошибка сервера';
  return e.fields?.file ?? e.fields?.name ?? e.message;
}

/** Вложения операции; null — операции ещё нет (новая). */
export function useAttachments(companyId: number, operationId: number | null) {
  return useQuery<Attachment[], ApiError>({
    queryKey: ['attachments', companyId, operationId],
    queryFn: async () => (await api<{ attachments: Attachment[] }>(`/companies/${companyId}/operations/${operationId}/attachments`)).attachments,
    enabled: operationId !== null,
  });
}

/** Ссылка скачивания: GET без побочных эффектов, ответ всегда «как файл» (план 4b). */
export function attachmentUrl(companyId: number, id: number): string {
  return `/api/v1/companies/${companyId}/attachments/${id}`;
}

/** После изменения вложений: список вложений операции и журнал (число вложений у операции). */
async function invalidateAttachments(companyId: number, operationId: number): Promise<void> {
  await Promise.all([
    queryClient.invalidateQueries({ queryKey: ['attachments', companyId, operationId] }),
    queryClient.invalidateQueries({ queryKey: ['journal', companyId] }),
  ]);
}

/**
 * Загрузить файл к операции: локально — байты телом (имя — в X-File-Name), на Vercel — сначала в Blob, затем ключ файла.
 * Ошибка сервера — `ApiError` (у типа файла — `fields.file`).
 */
export async function uploadAttachment(companyId: number, operationId: number, file: File): Promise<Attachment> {
  try {
    const path = `/companies/${companyId}/operations/${operationId}/attachments`;
    if ((await uploadMode()) === 'blob') {
      const blobKey = await uploadToBlob('attachment', file);
      return (await api<{ attachment: Attachment }>(path, { method: 'POST', body: { blobKey, fileName: file.name } })).attachment;
    }
    return (await api<{ attachment: Attachment }>(path, { method: 'POST', file: { data: file, name: file.name } })).attachment;
  } finally {
    void invalidateAttachments(companyId, operationId);
  }
}

/** Мягкое удаление вложения (§4.5): файл на диске остаётся. */
export async function removeAttachment(companyId: number, operationId: number, id: number): Promise<void> {
  try {
    await api(`/companies/${companyId}/attachments/${id}`, { method: 'DELETE' });
  } finally {
    void invalidateAttachments(companyId, operationId);
  }
}

/** Перетаскивают файлы (а не текст или ссылку): только их принимает зона «Перетяните сюда файл» (§6.7 этапа 1.5). */
export function isFileDrag(types: readonly string[]): boolean {
  return types.includes('Files');
}
