import { addDays, formatDateRu, formatDateShortRu } from '../../shared/dates';
import { formatAmount, formatMoney, MONEY_SCREEN } from '../../shared/money';
import type { OperationType } from './journal-filter';
import type { CategoryTree } from './queries';

const dayFormatters = new Map<string, Intl.DateTimeFormat>();

/** Календарная дата момента времени в поясе приложения (APP_TIMEZONE). */
export function dayOf(iso: string, timeZone: string): string {
  let fmt = dayFormatters.get(timeZone);
  if (!fmt) {
    fmt = new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' });
    dayFormatters.set(timeZone, fmt);
  }
  return fmt.format(new Date(iso));
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

/**
 * Дата операции в таблице журнала (§5.2 этапа 1.5): первая строка — «4 окт. 2026», вторая — время «10:32»,
 * для сегодня и вчера — «Сегодня 10:32», «Вчера 10:32» (сама дата остаётся). Всё — в поясе приложения.
 */
export function journalDateParts(iso: string, timeZone: string, today: string): { date: string; time: string } {
  const day = dayOf(iso, timeZone);
  const prefix = day === today ? 'Сегодня ' : day === addDays(today, -1) ? 'Вчера ' : '';
  return { date: formatDateShortRu(day), time: `${prefix}${timeLabel(iso, timeZone)}` };
}

/** Категория в ячейке журнала: название и собственный systemKey (бейдж «системная» — только у самой системной категории). */
export interface CategoryInfo {
  name: string;
  systemKey: string | null;
}

/** Категории плоским списком для ячеек: «Родитель», «Родитель → Дочерняя» (§5.2, §10.3 этапа 1.5). */
export function categoryLookup(tree: CategoryTree): Map<number, CategoryInfo> {
  const map = new Map<number, CategoryInfo>();
  for (const node of [...tree.income, ...tree.expense]) {
    map.set(node.id, { name: node.name, systemKey: node.systemKey });
    for (const child of node.children) map.set(child.id, { name: `${node.name} → ${child.name}`, systemKey: child.systemKey });
  }
  return map;
}

/** Русское множественное число: 1 категория, 2 категории, 5 категорий, 11 категорий, 21 категория. */
export function pluralRu(n: number, one: string, few: string, many: string): string {
  const d10 = n % 10;
  const d100 = n % 100;
  if (d10 === 1 && d100 !== 11) return one;
  if (d10 >= 2 && d10 <= 4 && (d100 < 12 || d100 > 14)) return few;
  return many;
}

/** «2 категории», «5 проектов» — подпись разбитой операции (§5.2 этапа 1.5). */
export function splitLabel(count: number, what: 'category' | 'project'): string {
  return what === 'category'
    ? `${count} ${pluralRu(count, 'категория', 'категории', 'категорий')}`
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

/** Сумма со знаком по типу: доход «+1 500 ₸», расход «\u22121 500,50 ₸» (знак минус U+2212; нулевые копейки не показываются), перевод без знака. */
export function signedMoney(type: OperationType, minor: number, currency: string): string {
  const sign = type === 'income' ? '+' : type === 'expense' ? '\u2212' : '';
  return `${sign}${formatMoney(minor, currency, MONEY_SCREEN)}`;
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
