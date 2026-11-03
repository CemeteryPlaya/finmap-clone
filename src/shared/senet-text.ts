import { formatDateTime } from './dates';

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

/** «01.10 10:00 — 22:00»; через полночь — с датой конца; открытая — «идёт». */
export function shiftPeriodLabel(openedAt: string, closedAt: string | null, timeZone: string): string {
  const f = (iso: string) => formatDateTime(iso, timeZone).replace(/^(\d{2}\.\d{2})\.\d{4},?/, '$1');
  const start = f(openedAt);
  if (!closedAt) return `${start} — идёт`;
  const end = f(closedAt);
  return `${start} — ${end.slice(0, 5) === start.slice(0, 5) ? end.slice(-5) : end}`;
}
