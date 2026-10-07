import { addDays, formatDateRu, todayInTimezone } from '../../shared/dates';
import { formatAmount, formatMoney } from '../../shared/money';
import type { OperationType } from './journal-filter';

/** Календарная дата момента времени в поясе приложения (APP_TIMEZONE). */
export function dayOf(iso: string, timeZone: string): string {
  return todayInTimezone(timeZone, new Date(iso));
}

/** Подпись даты в журнале: «сегодня», «вчера» или «ДД.ММ.ГГГГ». */
export function dayLabel(day: string, today: string): string {
  if (day === today) return 'сегодня';
  if (day === addDays(today, -1)) return 'вчера';
  return formatDateRu(day);
}

const timeFormatters = new Map<string, Intl.DateTimeFormat>();

/** Время «ЧЧ:ММ» в поясе приложения. */
export function timeLabel(iso: string, timeZone: string): string {
  let fmt = timeFormatters.get(timeZone);
  if (!fmt) {
    fmt = new Intl.DateTimeFormat('ru-RU', { timeZone, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
    timeFormatters.set(timeZone, fmt);
  }
  return fmt.format(new Date(iso));
}

/** Русское множественное число: 1 статья, 2 статьи, 5 статей, 11 статей, 21 статья. */
export function pluralRu(n: number, one: string, few: string, many: string): string {
  const d10 = n % 10;
  const d100 = n % 100;
  if (d10 === 1 && d100 !== 11) return one;
  if (d10 >= 2 && d10 <= 4 && (d100 < 12 || d100 > 14)) return few;
  return many;
}

/** «2 статьи», «5 проектов» — подпись разбитой операции (§7; «N категорий» спецификации — статьи, как везде в интерфейсе). */
export function splitLabel(count: number, what: 'category' | 'project'): string {
  return what === 'category'
    ? `${count} ${pluralRu(count, 'статья', 'статьи', 'статей')}`
    : `${count} ${pluralRu(count, 'проект', 'проекта', 'проектов')}`;
}

export interface LineLike {
  categoryId: number | null;
  projectId: number | null;
  amount: number;
}

/**
 * Значение измерения у строк операции: одно на все строки (`single`, может быть null — «не указано»)
 * или несколько разных (`many` с их числом; «не указано» тоже считается значением).
 */
export type LineDimension = { kind: 'single'; id: number | null } | { kind: 'many'; count: number };

export function lineDimension(lines: readonly LineLike[], key: 'categoryId' | 'projectId'): LineDimension {
  const values = new Set(lines.map((l) => l[key]));
  if (values.size <= 1) return { kind: 'single', id: lines[0]?.[key] ?? null };
  return { kind: 'many', count: values.size };
}

/**
 * «Доля проекта» (§7): при фильтре по проекту у разбитой операции — сумма её строк с выбранными проектами
 * в валюте счёта. У неразбитой операции и без фильтра по проекту — null.
 */
export function projectShare(lines: readonly LineLike[], projectIds: readonly number[]): number | null {
  if (projectIds.length === 0 || lines.length < 2) return null;
  const chosen = new Set(projectIds);
  return lines.filter((l) => l.projectId !== null && chosen.has(l.projectId)).reduce((s, l) => s + l.amount, 0);
}

/** Сумма со знаком по типу: доход «+1 500,00 ₸», расход «-1 500,00 ₸», перевод без знака. */
export function signedMoney(type: OperationType, minor: number, currency: string): string {
  const sign = type === 'income' ? '+' : type === 'expense' ? '\u2212' : '';
  return `${sign}${formatMoney(minor, currency)}`;
}

/** Минимальные единицы → текст поля ввода: «1500», «1500,5», «0,05» (без разрядов и лишних нулей). */
export function amountInputText(minor: number, minorUnits: number): string {
  return formatAmount(minor, minorUnits)
    .replace(/\u202F/g, '')
    .replace(/(,\d*?)0+$/, '$1')
    .replace(/,$/, '');
}

/**
 * Строки журнала из всех загруженных страниц без повторов по id (первое вхождение остаётся): страницы идут
 * по курсору, и операцию, которую другой пользователь изменил во время прокрутки, можно получить дважды —
 * ключи строк в таблице должны быть уникальными.
 */
export function uniqueById<T extends { id: number }>(items: readonly T[]): T[] {
  const seen = new Set<number>();
  const result: T[] = [];
  for (const item of items) {
    if (seen.has(item.id)) continue;
    seen.add(item.id);
    result.push(item);
  }
  return result;
}
