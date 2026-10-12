import { AppError } from '../errors';

export function parseId(value: unknown): number {
  const n = typeof value === 'string' && /^[0-9]+$/.test(value) ? Number(value) : NaN;
  if (!Number.isSafeInteger(n) || n <= 0) throw new AppError(404, 'NOT_FOUND', 'Не найдено');
  return n;
}

/** Имя файла из заголовка X-File-Name (URI-кодированное); битая кодировка — пустое имя. */
export function headerFileName(value: unknown): string {
  if (typeof value !== 'string') return '';
  try {
    return decodeURIComponent(value);
  } catch {
    return '';
  }
}
