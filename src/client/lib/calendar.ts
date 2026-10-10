import { addDays } from '../../shared/dates';

/** Заголовок календаря — именительный падеж (§6.5 этапа 1.5: «ОКТЯБРЬ 2026», заглавные — стилем). */
const MONTHS = ['Январь', 'Февраль', 'Март', 'Апрель', 'Май', 'Июнь', 'Июль', 'Август', 'Сентябрь', 'Октябрь', 'Ноябрь', 'Декабрь'];
/** Полная дата для программ чтения — родительный падеж: «4 октября 2026». */
const MONTHS_GENITIVE = ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня', 'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'];

/** Дни недели с понедельника: короткие — в шапке сетки, полные — `abbr` для программ чтения. */
export const WEEKDAYS: readonly { short: string; long: string }[] = [
  { short: 'Пн', long: 'понедельник' },
  { short: 'Вт', long: 'вторник' },
  { short: 'Ср', long: 'среда' },
  { short: 'Чт', long: 'четверг' },
  { short: 'Пт', long: 'пятница' },
  { short: 'Сб', long: 'суббота' },
  { short: 'Вс', long: 'воскресенье' },
];

const parts = (date: string) => date.split('-').map(Number) as [number, number, number];
const pad = (n: number, width = 2) => String(n).padStart(width, '0');
const daysInMonth = (year: number, month: number) => new Date(Date.UTC(year, month, 0)).getUTCDate();

/** `YYYY-MM-DD` → «Октябрь 2026». */
export function monthTitle(date: string): string {
  const [y, m] = parts(date);
  return `${MONTHS[m - 1]} ${y}`;
}

/** `YYYY-MM-DD` → «4 октября 2026». */
export function longDateRu(date: string): string {
  const [y, m, d] = parts(date);
  return `${d} ${MONTHS_GENITIVE[m - 1]} ${y}`;
}

/** День недели: понедельник — 0, воскресенье — 6. */
export function weekdayOf(date: string): number {
  const [y, m, d] = parts(date);
  return (new Date(Date.UTC(y, m - 1, d)).getUTCDay() + 6) % 7;
}

/** Сдвиг на n месяцев; число — не больше последнего дня нового месяца (31 января + 1 месяц = 28 или 29 февраля). */
export function addMonths(date: string, n: number): string {
  const [y, m, d] = parts(date);
  const total = y * 12 + (m - 1) + n;
  const year = Math.floor(total / 12);
  const month = total - year * 12 + 1;
  return `${pad(year, 4)}-${pad(month)}-${pad(Math.min(d, daysInMonth(year, month)))}`;
}

/** Даты в одном месяце. */
export function sameMonth(a: string, b: string): boolean {
  return a.slice(0, 7) === b.slice(0, 7);
}

/** Недели месяца даты date: от понедельника первой недели до воскресенья последней, с днями соседних месяцев. */
export function monthWeeks(date: string): string[][] {
  const [y, m] = parts(date);
  const first = `${pad(y, 4)}-${pad(m)}-01`;
  const last = `${pad(y, 4)}-${pad(m)}-${pad(daysInMonth(y, m))}`;
  const end = addDays(last, 6 - weekdayOf(last));
  const weeks: string[][] = [];
  let day = addDays(first, -weekdayOf(first));
  while (day <= end) {
    const week: string[] = [];
    for (let i = 0; i < 7; i++) {
      week.push(day);
      day = addDays(day, 1);
    }
    weeks.push(week);
  }
  return weeks;
}

/**
 * Куда переходит активный день сетки по клавише (§11 этапа 1.5, шаблон WAI-ARIA «date picker»): стрелки — день
 * и неделя, Home/End — начало и конец недели, PageUp/PageDown — месяц, с Shift — год. Другая клавиша — null.
 */
export function moveDate(date: string, key: string, shiftKey: boolean): string | null {
  switch (key) {
    case 'ArrowLeft':
      return addDays(date, -1);
    case 'ArrowRight':
      return addDays(date, 1);
    case 'ArrowUp':
      return addDays(date, -7);
    case 'ArrowDown':
      return addDays(date, 7);
    case 'Home':
      return addDays(date, -weekdayOf(date));
    case 'End':
      return addDays(date, 6 - weekdayOf(date));
    case 'PageUp':
      return addMonths(date, shiftKey ? -12 : -1);
    case 'PageDown':
      return addMonths(date, shiftKey ? 12 : 1);
    default:
      return null;
  }
}
