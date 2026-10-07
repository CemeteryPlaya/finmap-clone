import { addDays, isValidDate } from '../../shared/dates';
import { JOURNAL_LIST_MAX } from '../../shared/schemas/journal';

/** Периоды тулбара журнала (§7). Относительные периоды считаются от «сегодня» в APP_TIMEZONE. */
export const PERIODS = [
  { key: 'all', label: 'Всё время' },
  { key: 'today', label: 'Сегодня' },
  { key: 'yesterday', label: 'Вчера' },
  { key: 'week', label: 'Текущая неделя' },
  { key: 'lastWeek', label: 'Прошлая неделя' },
  { key: 'month', label: 'Текущий месяц' },
  { key: 'lastMonth', label: 'Прошлый месяц' },
  { key: 'year', label: 'Текущий год' },
  { key: 'custom', label: 'Произвольно' },
] as const;

export type PeriodKey = (typeof PERIODS)[number]['key'];
export type OperationType = 'income' | 'expense' | 'transfer';
export type JournalSortKey = 'date' | 'amount';
export type JournalSortOrder = 'asc' | 'desc';

export const OPERATION_TYPES: readonly OperationType[] = ['income', 'expense', 'transfer'];

/**
 * Фильтр журнала в адресной строке. Списки — по возрастанию без повторов; суммы — минимальные единицы
 * базовой валюты компании; from/to — только у периода «Произвольно».
 */
export interface JournalUrlState {
  period: PeriodKey;
  from?: string;
  to?: string;
  q?: string;
  amountMin?: number;
  amountMax?: number;
  types: OperationType[];
  accountIds: number[];
  categoryIds: number[];
  projectIds: number[];
  counterpartyIds: number[];
  tagIds: number[];
  withoutCategory: boolean;
  withoutProject: boolean;
  withoutCounterparty: boolean;
  sort: JournalSortKey;
  order: JournalSortOrder;
}

export const EMPTY_JOURNAL_STATE: JournalUrlState = {
  period: 'all',
  types: [],
  accountIds: [],
  categoryIds: [],
  projectIds: [],
  counterpartyIds: [],
  tagIds: [],
  withoutCategory: false,
  withoutProject: false,
  withoutCounterparty: false,
  sort: 'date',
  order: 'desc',
};

/** Ключи адресной строки для списков: `?account=5` из левой панели (решение 3 плана 4b) — тот же ключ. */
const LIST_KEYS = {
  accountIds: 'account',
  categoryIds: 'category',
  projectIds: 'project',
  counterpartyIds: 'counterparty',
  tagIds: 'tag',
} as const;
type ListField = keyof typeof LIST_KEYS;
const LIST_FIELDS = Object.keys(LIST_KEYS) as ListField[];

const FLAG_KEYS = {
  withoutCategory: 'noCategory',
  withoutProject: 'noProject',
  withoutCounterparty: 'noCounterparty',
} as const;
type FlagField = keyof typeof FLAG_KEYS;
const FLAG_FIELDS = Object.keys(FLAG_KEYS) as FlagField[];

/** Длина поиска — как у сервера (journalFilterSchema). */
export const SEARCH_MAX = 200;

/** Без повторов, по возрастанию. */
export const sortedUnique = <T extends number | string>(xs: T[]): T[] => [...new Set(xs)].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));

/** Идентификаторы из адреса: только положительные целые, без повторов, не больше, чем принимает сервер. */
function ids(values: string[]): number[] {
  return sortedUnique(values.filter((v) => /^\d{1,15}$/.test(v)).map(Number).filter((n) => n > 0 && Number.isSafeInteger(n))).slice(0, JOURNAL_LIST_MAX);
}

function minor(value: string | null): number | undefined {
  if (value === null || !/^\d{1,16}$/.test(value)) return undefined;
  const n = Number(value);
  return Number.isSafeInteger(n) ? n : undefined;
}

const isPeriod = (v: string | null): v is PeriodKey => PERIODS.some((p) => p.key === v);

/**
 * Адресная строка → фильтр. Разбор мягкий: неверные значения отбрасываются, перепутанные границы
 * периода и суммы меняются местами — журнал не должен падать из-за ручной правки адреса.
 */
export function parseJournalSearch(params: URLSearchParams): JournalUrlState {
  const state: JournalUrlState = { ...EMPTY_JOURNAL_STATE };
  let from = params.get('from') ?? undefined;
  let to = params.get('to') ?? undefined;
  if (from !== undefined && !isValidDate(from)) from = undefined;
  if (to !== undefined && !isValidDate(to)) to = undefined;
  if (from && to && from > to) [from, to] = [to, from];
  const period = params.get('period');
  if (isPeriod(period) && period !== 'custom') state.period = period;
  else if (period === 'custom' || from || to) {
    state.period = 'custom';
    if (from) state.from = from;
    if (to) state.to = to;
  }

  const q = (params.get('q') ?? '').trim().slice(0, SEARCH_MAX).trim();
  if (q) state.q = q;
  let amountMin = minor(params.get('min'));
  let amountMax = minor(params.get('max'));
  if (amountMin !== undefined && amountMax !== undefined && amountMin > amountMax) [amountMin, amountMax] = [amountMax, amountMin];
  if (amountMin !== undefined) state.amountMin = amountMin;
  if (amountMax !== undefined) state.amountMax = amountMax;

  state.types = OPERATION_TYPES.filter((t) => params.getAll('type').includes(t));
  for (const field of LIST_FIELDS) state[field] = ids(params.getAll(LIST_KEYS[field]));
  for (const field of FLAG_FIELDS) state[field] = params.get(FLAG_KEYS[field]) === '1';
  if (params.get('sort') === 'amount') state.sort = 'amount';
  if (params.get('order') === 'asc') state.order = 'asc';
  return state;
}

/** Фильтр → адресная строка: только отличия от значений по умолчанию, в постоянном порядке. */
export function journalSearch(state: JournalUrlState): URLSearchParams {
  const p = new URLSearchParams();
  if (state.period === 'custom') {
    if (state.from) p.set('from', state.from);
    if (state.to) p.set('to', state.to);
    if (!state.from && !state.to) p.set('period', 'custom');
  } else if (state.period !== 'all') p.set('period', state.period);
  if (state.q) p.set('q', state.q);
  if (state.amountMin !== undefined) p.set('min', String(state.amountMin));
  if (state.amountMax !== undefined) p.set('max', String(state.amountMax));
  for (const t of state.types) p.append('type', t);
  for (const field of LIST_FIELDS) for (const id of state[field]) p.append(LIST_KEYS[field], String(id));
  for (const field of FLAG_FIELDS) if (state[field]) p.set(FLAG_KEYS[field], '1');
  if (state.sort !== 'date') p.set('sort', state.sort);
  if (state.order !== 'desc') p.set('order', state.order);
  return p;
}

function weekday(date: string): number {
  const [y, m, d] = date.split('-').map(Number) as [number, number, number];
  return (new Date(Date.UTC(y, m - 1, d)).getUTCDay() + 6) % 7; // понедельник — 0
}

function lastDayOfMonth(year: number, month: number): string {
  return new Date(Date.UTC(year, month, 0)).toISOString().slice(0, 10);
}

/** Границы периода (включительно) от сегодняшней даты в APP_TIMEZONE; неделя — с понедельника. */
export function periodRange(state: Pick<JournalUrlState, 'period' | 'from' | 'to'>, today: string): { from?: string; to?: string } {
  const [y, m] = today.split('-').map(Number) as [number, number];
  const pad = (n: number) => String(n).padStart(2, '0');
  switch (state.period) {
    case 'all':
      return {};
    case 'today':
      return { from: today, to: today };
    case 'yesterday': {
      const d = addDays(today, -1);
      return { from: d, to: d };
    }
    case 'week': {
      const monday = addDays(today, -weekday(today));
      return { from: monday, to: addDays(monday, 6) };
    }
    case 'lastWeek': {
      const monday = addDays(today, -weekday(today) - 7);
      return { from: monday, to: addDays(monday, 6) };
    }
    case 'month':
      return { from: `${y}-${pad(m)}-01`, to: lastDayOfMonth(y, m) };
    case 'lastMonth': {
      const py = m === 1 ? y - 1 : y;
      const pm = m === 1 ? 12 : m - 1;
      return { from: `${py}-${pad(pm)}-01`, to: lastDayOfMonth(py, pm) };
    }
    case 'year':
      return { from: `${y}-01-01`, to: `${y}-12-31` };
    case 'custom':
      return { ...(state.from ? { from: state.from } : {}), ...(state.to ? { to: state.to } : {}) };
  }
}

/**
 * Параметры API журнала и выгрузки (план 5a): списки — повтором ключа, флаги — `true`, суммы — минимальные единицы.
 * Без курсора и размера страницы.
 */
export function journalApiParams(state: JournalUrlState, today: string): URLSearchParams {
  const p = new URLSearchParams();
  const range = periodRange(state, today);
  if (range.from) p.set('from', range.from);
  if (range.to) p.set('to', range.to);
  if (state.q) p.set('q', state.q);
  if (state.amountMin !== undefined) p.set('amountMin', String(state.amountMin));
  if (state.amountMax !== undefined) p.set('amountMax', String(state.amountMax));
  for (const t of state.types) p.append('types', t);
  for (const field of LIST_FIELDS) for (const id of state[field]) p.append(field, String(id));
  for (const field of FLAG_FIELDS) if (state[field]) p.set(field, 'true');
  p.set('sort', state.sort);
  p.set('order', state.order);
  return p;
}

/** Сколько условий выбрано в модалке «Фильтр»: тип, счета, статьи, проекты, контрагенты, теги (по измерению). */
export function filterConditionCount(state: JournalUrlState): number {
  return [
    state.types.length > 0,
    state.accountIds.length > 0,
    state.categoryIds.length > 0 || state.withoutCategory,
    state.projectIds.length > 0 || state.withoutProject,
    state.counterpartyIds.length > 0 || state.withoutCounterparty,
    state.tagIds.length > 0,
  ].filter(Boolean).length;
}

/** Задано хоть одно условие (включая период, поиск и сумму) — сортировка не в счёт. */
export function isFiltered(state: JournalUrlState): boolean {
  return state.period !== 'all' || !!state.q || state.amountMin !== undefined || state.amountMax !== undefined || filterConditionCount(state) > 0;
}

/** Сброс условий с сохранением сортировки. */
export function clearFilter(state: JournalUrlState): JournalUrlState {
  return { ...EMPTY_JOURNAL_STATE, sort: state.sort, order: state.order };
}
