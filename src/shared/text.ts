import { z } from 'zod';

/** Невидимые символы, из-за которых «пустое» или «то же самое» название выглядит иначе. */
const INVISIBLE = /[\u00AD\u180E\u200B-\u200F\u202A-\u202E\u2060-\u2064\uFEFF]/g;

/** Название справочника: NFC, без невидимых символов, пробелы схлопнуты, края обрезаны. */
export function cleanName(value: string): string {
  return value.normalize('NFC').replace(INVISIBLE, '').replace(/\s+/g, ' ').trim();
}

/** zod-поле названия: чистит и проверяет длину уже очищенной строки. */
export function nameField(max: number, emptyMessage = 'Введите название') {
  return z
    .string()
    .transform(cleanName)
    .pipe(z.string().min(1, emptyMessage).max(max, `Не длиннее ${max} символов`));
}
