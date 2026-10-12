import { foldCase } from './search';
import { SYSTEM_CATEGORIES, type CategoryKind, type SystemKey } from './system-categories';
import { cleanName } from './text';

/**
 * Формат файла Finmap (§2 спецификации импорта): колонки A–P шаблона импорта и выгрузки «Excel»,
 * ключи заголовков и названий. Общий для сервера и окна «Собрать Excel».
 */
export type FinmapField =
  | 'paidAt'
  | 'accrualDate'
  | 'periodFrom'
  | 'periodTo'
  | 'amount'
  | 'baseAmount'
  | 'fromAccount'
  | 'toAccount'
  | 'category'
  | 'subcategory'
  | 'counterparty'
  | 'subcounterparty'
  | 'project'
  | 'subproject'
  | 'tags'
  | 'comment';

export interface FinmapColumn {
  field: FinmapField;
  /** Заголовок шаблона Finmap, со звёздочкой у обязательных. */
  header: string;
}

/** Колонки A–P в порядке шаблона (§2.1). */
export const FINMAP_COLUMNS: readonly FinmapColumn[] = [
  { field: 'paidAt', header: 'Дата платежа*' },
  { field: 'accrualDate', header: 'Дата начисления' },
  { field: 'periodFrom', header: 'Период начисления (дата "с")' },
  { field: 'periodTo', header: 'Период начисления (дата "по")' },
  { field: 'amount', header: 'Сумма в валюте счета*' },
  { field: 'baseAmount', header: 'Сумма в валюте компании' },
  { field: 'fromAccount', header: 'Со счета*' },
  { field: 'toAccount', header: 'На счет*' },
  { field: 'category', header: 'Категория' },
  { field: 'subcategory', header: 'Подкатегория' },
  { field: 'counterparty', header: 'Контрагент' },
  { field: 'subcounterparty', header: 'Подконтрагент' },
  { field: 'project', header: 'Проект' },
  { field: 'subproject', header: 'Подпроект' },
  { field: 'tags', header: 'Теги' },
  { field: 'comment', header: 'Комментарий' },
];

/** Название колонки для сообщений: заголовок шаблона без звёздочки («Со счета»). */
export function columnTitle(field: FinmapField): string {
  return FINMAP_COLUMNS.find((c) => c.field === field)!.header.replace('*', '');
}

/** Пары «латинская буква → кириллическая» по порядку символов двух строк одной длины. */
function pairs(latin: string, cyrillic: string): Record<string, string> {
  return Object.fromEntries([...latin].map((ch, i) => [ch, cyrillic[i]!]));
}

/** Латинские двойники кириллицы (§2.2): A B C E H K M O P T X a c e o p x y → А В С Е Н К М О Р Т Х а с е о р х у. */
const TWINS = pairs('ABCEHKMOPTXaceopxy', 'АВСЕНКМОРТХасеорху');
const TWIN_RE = /[ABCEHKMOPTXaceopxy]/g;
/**
 * Ключ сравнения строится после foldCase, поэтому заглавным двойникам B H K M T нужны и строчные пары
 * (b → в, h → н, k → к, m → м, t → т): иначе «STEAM» и «Steam» дали бы разные ключи.
 */
const KEY_TWINS = pairs('abcehkmoptxy', 'авсенкмортху');

/**
 * Ключ сравнения названий (§4.9): cleanName, нижний регистр по правилам ru с «ё» → «е», латинские двойники → кириллица.
 * «Kacca», «КАССА» и «касса» совпадают; «Kaspi» и «Каспи» — нет (у s и i пары нет). Зависит только от
 * foldCase(cleanName(s)), поэтому совпадение ключа тега (tagKey) и проекта (ulower) влечёт совпадение nameKey.
 */
export function nameKey(s: string): string {
  return foldCase(cleanName(s)).replace(/[abcehkmoptxy]/g, (ch) => KEY_TWINS[ch]!);
}

/** Ключ заголовка колонки (§2.2): как nameKey, без «*», кавычек любого вида; пробелы схлопнуты. */
export function headerKey(s: string): string {
  return nameKey(cleanName(s).replace(/[*"'«»„“”‘’]/g, ''));
}

const FIELD_BY_KEY = new Map(FINMAP_COLUMNS.map((c) => [headerKey(c.header), c.field]));

/** Колонка по заголовку файла; null — заголовок не распознан. */
export function headerField(title: string): FinmapField | null {
  return FIELD_BY_KEY.get(headerKey(title)) ?? null;
}

/** Сколько разных колонок §2.1 распознано в строке (выбор разделителя CSV). */
export function countKnownHeaders(values: string[]): number {
  return new Set(values.map(headerField).filter((f) => f !== null)).size;
}

/** Строка заголовков: есть «Дата платежа» и «Сумма в валюте счета» (§2.2). */
export function isHeaderRow(values: string[]): boolean {
  const fields = new Set(values.map(headerField));
  return fields.has('paidAt') && fields.has('amount');
}

/**
 * Название, которое создаётся (§4.9): в словах с кириллицей латинские двойники заменяются кириллицей
 * («Kacca» с кириллической «с» → «Касса»); чисто латинские слова («Kaspi», «Steam», «PC») не трогаются.
 */
export function repairName(s: string): string {
  return cleanName(s).replace(/\p{L}+/gu, (word) => (/\p{Script=Cyrillic}/u.test(word) ? word.replace(TWIN_RE, (ch) => TWINS[ch]!) : word));
}

/**
 * Другие написания системных категорий Finmap (§4.5). Пусто, пока сверка §12 шаг 2 не покажет различий;
 * наполнять — только названиями из интерфейса Finmap.
 */
export const FINMAP_SYSTEM_ALIASES: readonly { name: string; kind: CategoryKind; key: SystemKey }[] = [];

/** Системная категория по названию из файла и виду операции; системное название с чужим видом — null. */
export function systemKeyOf(name: string, kind: CategoryKind): SystemKey | null {
  const key = nameKey(name);
  const own = SYSTEM_CATEGORIES.find((c) => c.kind === kind && nameKey(c.name) === key);
  if (own) return own.key;
  return FINMAP_SYSTEM_ALIASES.find((a) => a.kind === kind && nameKey(a.name) === key)?.key ?? null;
}
