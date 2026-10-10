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

/** Дата и время до секунд в поясе приложения: «04.10.2026, 10:32:15» (панель «История действий», §3.4 этапа 1.5). */
export function formatDateTimeSec(iso: string, timeZone: string): string {
  return new Intl.DateTimeFormat('ru-RU', {
    timeZone,
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  }).format(new Date(iso));
}

/** Календарная дата `YYYY-MM-DD`, сдвинутая на days дней. */
export function addDays(date: string, days: number): string {
  const [y, m, d] = date.split('-').map(Number) as [number, number, number];
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}

/** Форматтеры по поясу: создание Intl.DateTimeFormat дорогое, а выгрузка зовёт zoneOffsetMs на каждую строку. */
const offsetFormatters = new Map<string, Intl.DateTimeFormat>();

/** Смещение пояса timeZone относительно UTC в момент t (мс; местное время минус UTC). */
export function zoneOffsetMs(t: number, timeZone: string): number {
  let fmt = offsetFormatters.get(timeZone);
  if (!fmt) {
    fmt = new Intl.DateTimeFormat('en-US', {
      timeZone,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
    offsetFormatters.set(timeZone, fmt);
  }
  const whole = Math.floor(t / 1000) * 1000; // Intl отбрасывает миллисекунды
  const parts = fmt.formatToParts(new Date(whole));
  const get = (type: string) => Number(parts.find((p) => p.type === type)!.value);
  return Date.UTC(get('year'), get('month') - 1, get('day'), get('hour'), get('minute'), get('second')) - whole;
}

/**
 * Начало календарного дня `YYYY-MM-DD` в поясе timeZone — момент UTC в формате `paidAt` (§4.1).
 * Смещение берётся на эту дату: в Алматы до 01.03.2024 было UTC+6, после — UTC+5.
 */
export function startOfDayUtc(date: string, timeZone: string): string {
  const [y, m, d] = date.split('-').map(Number) as [number, number, number];
  const wall = Date.UTC(y, m - 1, d);
  // второй шаг уточняет смещение, если на границе суток оно другое, чем в полночь по UTC
  const first = wall - zoneOffsetMs(wall, timeZone);
  return new Date(wall - zoneOffsetMs(first, timeZone)).toISOString();
}
