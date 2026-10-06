import { z } from 'zod';

/** Невидимые символы, из-за которых «пустое» или «то же самое» название выглядит иначе. */
const INVISIBLE = /[­᠎​-‏‪-‮⁠-⁤﻿]/g;

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
