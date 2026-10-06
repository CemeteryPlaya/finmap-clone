export function todayInTimezone(timezone: string, now: Date = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
}

const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

/** Строка `YYYY-MM-DD` и существующая календарная дата (2026-02-31 — нет). */
export function isValidDate(value: string): boolean {
  const m = DATE_RE.exec(value);
  if (!m) return false;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  const dt = new Date(Date.UTC(y, mo - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === mo - 1 && dt.getUTCDate() === d;
}

/** `YYYY-MM-DD` → `ДД.ММ.ГГГГ`. */
export function formatDateRu(value: string): string {
  const [y, m, d] = value.split('-');
  return `${d}.${m}.${y}`;
}

/** Момент времени → «ДД.ММ.ГГГГ, ЧЧ:ММ» в заданном часовом поясе (APP_TIMEZONE из /meta). */
export function formatDateTime(iso: string, timeZone: string): string {
  return new Intl.DateTimeFormat('ru-RU', {
    timeZone,
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).format(new Date(iso));
}
