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

/** Сокращения месяцев, как в Finmap (§2.3 этапа 1.5): «4 окт. 2026», «4 мая 2026». */
const SHORT_MONTHS = ['янв.', 'февр.', 'мар.', 'апр.', 'мая', 'июн.', 'июл.', 'авг.', 'сент.', 'окт.', 'нояб.', 'дек.'];

/** `YYYY-MM-DD` → «4 окт. 2026»: число без нуля, без «г.» (журнал, «Дата сделки»). */
export function formatDateShortRu(value: string): string {
  const [y, m, d] = value.split('-');
  return `${Number(d)} ${SHORT_MONTHS[Number(m) - 1]} ${y}`;
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

/** Дни недели с заглавной для поля даты формы (§2.3 этапа 1.5); индекс — getUTCDay(). */
const WEEKDAY_NAMES = ['Воскресенье', 'Понедельник', 'Вторник', 'Среда', 'Четверг', 'Пятница', 'Суббота'];

/**
 * Значение поля даты и времени формы (§2.3 этапа 1.5): «Сегодня, 10.10.2026, 15:58», «Вчера, 09.10.2026, 22:09», иначе
 * день недели с заглавной — «Воскресенье, 04.10.2026, 10:31». date и today — календарные даты в APP_TIMEZONE, time — «ЧЧ:ММ».
 */
export function formatDateTimeField(date: string, time: string, today: string): string {
  const [y, m, d] = date.split('-').map(Number) as [number, number, number];
  const head = date === today ? 'Сегодня' : date === addDays(today, -1) ? 'Вчера' : WEEKDAY_NAMES[new Date(Date.UTC(y, m - 1, d)).getUTCDay()]!;
  return `${head}, ${formatDateRu(date)}, ${time}`;
}

/** Форматтеры времени суток по поясу. */
const timeFormatters = new Map<string, Intl.DateTimeFormat>();

/** Время суток момента в поясе timeZone: «ЧЧ:ММ», 24 часа. */
export function timeOfDay(iso: string, timeZone: string): string {
  let fmt = timeFormatters.get(timeZone);
  if (!fmt) {
    fmt = new Intl.DateTimeFormat('en-GB', { timeZone, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
    timeFormatters.set(timeZone, fmt);
  }
  return fmt.format(new Date(iso));
}

/** Ввод времени (§6.5 этапа 1.5): «9:05», «09:05», «0905», «905», «9.05» → «09:05»; иначе null. */
export function parseTimeInput(text: string): string | null {
  const m = /^(\d{1,2})[:.]?(\d{2})$/.exec(text.trim());
  if (!m) return null;
  const hours = Number(m[1]);
  const minutes = Number(m[2]);
  if (hours > 23 || minutes > 59) return null;
  return `${String(hours).padStart(2, '0')}:${m[2]}`;
}
