/**
 * Нормализация комментария выемки Senet (спецификация 2026-11-02-senet-autopost, §4.3): нижний регистр, «ё» → «е», всё,
 * кроме букв, цифр и «_», — пробел, пробелы схлопнуты, края обрезаны. Латиница не переводится: кассиры пишут транслитом.
 */
export function normalizeComment(comment: string): string {
  return comment
    .toLowerCase()
    .replace(/ё/g, 'е')
    .replace(/[^\p{L}\p{N}_]+/gu, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}
