import { AppError } from '../errors';

export function parseId(value: unknown): number {
  const n = typeof value === 'string' && /^[0-9]+$/.test(value) ? Number(value) : NaN;
  if (!Number.isSafeInteger(n) || n <= 0) throw new AppError(404, 'NOT_FOUND', 'Не найдено');
  return n;
}
