import { addDays, formatDateRu, isValidDate } from '../../shared/dates';
import { JOURNAL_LIST_MAX } from '../../shared/schemas/journal';

/**
 * Пункты меню периода (§5.1 этапа 1.5) в порядке Finmap; «За сегодня» и «За вчера» — наши, перед «Выбрать даты».
 * Относительные периоды считаются от «сегодня» в APP_TIMEZONE. Ключи — значения `period` в адресе.
 */
export const PERIODS = [
  { key: 'year', label: 'За текущий год' },
  { key: 'lastYear', label: 'За предыдущий год' },
  { key: 'week', label: 'За текущую неделю' },
  { key: 'lastWeek', label: 'За прошлую неделю' },
  { key: 'month', label: 'За текущий месяц' },
  { key: 'lastMonth', label: 'За прошлый месяц' },
  { key: 'all', label: 'За все время' },
  { key: 'today', label: 'За сегодня' },
  { key: 'yesterday', label: 'За вчера' },
  { key: 'custom', label: 'Выбрать даты' },
] as const;

export type PeriodKey = (typeof PERIODS)[number]['key'];
export type OperationType = 'income' | 'expense' | 'transfer';
export type JournalSortKey = 'date' | 'amount';
export type JournalSortOrder = 'asc' | 'desc';

export const OPERATION_TYPES: readonly OperationType[] = ['income', 'expense', 'transfer'];

/**
 * Фильтр журнала в адресной строке. Списки — по возрастанию без повторов; суммы — минимальные единицы
 * базовой валюты компании; from/to — только у периода «Выбрать даты» (custom).
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

/** Как на сервере: год не выше 9998 (иначе API ответит 400). */
const validDate = (v: string): boolean => isValidDate(v) && v < '9999';

const isPeriod = (v: string | null): v is PeriodKey => PERIODS.some((p) => p.key === v);

/**
 * Адресная строка → фильтр. Разбор мягкий: неверные значения отбрасываются, перепутанные границы
 * периода и суммы меняются местами — журнал не должен падать из-за ручной правки адреса.
 */
export function parseJournalSearch(params: URLSearchParams): JournalUrlState {
  const state: JournalUrlState = { ...EMPTY_JOURNAL_STATE };
  let from = params.get('from') ?? undefined;
  let to = params.get('to') ?? undefined;
  if (from !== undefined && !validDate(from)) from = undefined;
  if (to !== undefined && !validDate(to)) to = undefined;
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
    case 'lastYear':
      return { from: `${y - 1}-01-01`, to: `${y - 1}-12-31` };
    case 'custom':
      return { ...(state.from ? { from: state.from } : {}), ...(state.to ? { to: state.to } : {}) };
  }
}

/** Период и свои даты — общее у журнала и отчётов «Аналитики» (меню периода). */
export interface PeriodFields<P extends PeriodKey = PeriodKey> {
  period: P;
  from?: string;
  to?: string;
}

/**
 * Фильтр с другим периодом (меню периода, §5.1 этапа 1.5). У обычного периода границ from/to нет. У «Выбрать даты»
 * границы из range: можно одну; перепутанные меняются местами — журнал не пустеет из-за порядка полей.
 */
export function withPeriod<S extends PeriodFields>(state: S, period: S['period'], range: { from?: string; to?: string } = {}): S {
  const next: S = { ...state, period };
  delete next.from;
  delete next.to;
  if (period !== 'custom') return next;
  let { from, to } = range;
  if (from && to && from > to) [from, to] = [to, from];
  if (from) next.from = from;
  if (to) next.to = to;
  return next;
}

/** Подпись пилюли периода: пункт меню, у своих дат — «04.10.2026 – 10.10.2026», «с 04.10.2026», «по 10.10.2026»; при совпадении границ — одна дата. */
export function periodLabel(state: Pick<JournalUrlState, 'period' | 'from' | 'to'>): string {
  if (state.period !== 'custom') return PERIODS.find((p) => p.key === state.period)?.label ?? '';
  if (state.from && state.to && state.from === state.to) return formatDateRu(state.from);
  if (state.from && state.to) return `${formatDateRu(state.from)} – ${formatDateRu(state.to)}`;
  if (state.from) return `с ${formatDateRu(state.from)}`;
  if (state.to) return `по ${formatDateRu(state.to)}`;
  return 'Выбрать даты';
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

/**
 * Ссылка на выгрузку по фильтру (§8 спецификации импорта) — те же параметры, что у журнала, и `format`: «Excel» —
 * `finmap`, «Собрать Excel» — `custom` с `columns` в выбранном порядке (повтором ключа).
 */
export function journalExportHref(companyId: number, state: JournalUrlState, today: string, format: 'finmap' | 'custom' = 'finmap', columns: readonly string[] = []): string {
  const p = journalApiParams(state, today);
  p.set('format', format);
  if (format === 'custom') for (const c of columns) p.append('columns', c);
  return `/api/v1/companies/${companyId}/operations/export.xlsx?${p.toString()}`;
}

/** Сколько условий выбрано в модалке «Фильтр»: тип, счета, категории, проекты, контрагенты, теги (по измерению). */
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

/**
 * Число условий на воронке телефона (§8.5 этапа 1.5): всё, что задаёт окно «Фильтры» на телефоне, — период, сумма
 * от и до (каждая) и условия окна. Поиск на виду, сортировка не в счёт.
 */
export function phoneFilterCount(state: JournalUrlState): number {
  return (state.period !== 'all' ? 1 : 0) + (state.amountMin !== undefined ? 1 : 0) + (state.amountMax !== undefined ? 1 : 0) + filterConditionCount(state);
}

/** Сортировка на телефоне — списком: у карточек нет заголовков колонок. */
export const SORT_CHOICES: readonly { sort: JournalSortKey; order: JournalSortOrder; label: string }[] = [
  { sort: 'date', order: 'desc', label: 'Сначала новые' },
  { sort: 'date', order: 'asc', label: 'Сначала старые' },
  { sort: 'amount', order: 'desc', label: 'Сначала крупные' },
  { sort: 'amount', order: 'asc', label: 'Сначала мелкие' },
];

/** Задано хоть одно условие (включая период, поиск и сумму) — сортировка не в счёт. */
export function isFiltered(state: JournalUrlState): boolean {
  return state.period !== 'all' || !!state.q || state.amountMin !== undefined || state.amountMax !== undefined || filterConditionCount(state) > 0;
}

/** Сброс условий с сохранением сортировки. */
export function clearFilter(state: JournalUrlState): JournalUrlState {
  return { ...EMPTY_JOURNAL_STATE, sort: state.sort, order: state.order };
}

/** Поля фильтра, которыми управляет модалка «Фильтр»: тип, счета, категории, проекты, контрагенты, теги и «без …». */
export type DialogFields = Pick<
  JournalUrlState,
  'types' | 'accountIds' | 'categoryIds' | 'projectIds' | 'counterpartyIds' | 'tagIds' | 'withoutCategory' | 'withoutProject' | 'withoutCounterparty'
>;

/** Поля модалки из фильтра — начальный черновик. */
export function pickDialogFields(state: DialogFields): DialogFields {
  return {
    types: state.types,
    accountIds: state.accountIds,
    categoryIds: state.categoryIds,
    projectIds: state.projectIds,
    counterpartyIds: state.counterpartyIds,
    tagIds: state.tagIds,
    withoutCategory: state.withoutCategory,
    withoutProject: state.withoutProject,
    withoutCounterparty: state.withoutCounterparty,
  };
}

/**
 * Черновик модалки поверх ТЕКУЩЕГО фильтра: меняются только её поля. Поиск, период, сумма и сортировка
 * остаются как есть — например, запрос, который дошёл до адреса, пока окно было открыто.
 */
export function applyDialogFields(state: JournalUrlState, draft: DialogFields): JournalUrlState {
  return { ...state, ...pickDialogFields(draft) };
}

/** Поля окна «Фильтры» на телефоне сверх условий окна (§8.5 этапа 1.5): период, сумма от и до, сортировка. */
export type PhoneFilterFields = Pick<JournalUrlState, 'period' | 'from' | 'to' | 'amountMin' | 'amountMax' | 'sort' | 'order'>;

/**
 * Черновик окна «Фильтры»: условия окна и — если окно открыли на телефоне — период, сумма и сортировка. Режим
 * запоминается при открытии: окно браузера стало шире при открытом окне — набранный период не теряется.
 */
export interface FilterDraft {
  fields: DialogFields;
  phone: PhoneFilterFields | null;
}

/** Период, сумма и сортировка фильтра; пустые границы и суммы не пишутся. */
export function pickPhoneFilterFields(state: JournalUrlState): PhoneFilterFields {
  const f: PhoneFilterFields = { period: state.period, sort: state.sort, order: state.order };
  if (state.from !== undefined) f.from = state.from;
  if (state.to !== undefined) f.to = state.to;
  if (state.amountMin !== undefined) f.amountMin = state.amountMin;
  if (state.amountMax !== undefined) f.amountMax = state.amountMax;
  return f;
}

/** Начальный черновик окна по текущему фильтру. */
export function filterDraftFrom(state: JournalUrlState, phone: boolean): FilterDraft {
  return { fields: pickDialogFields(state), phone: phone ? pickPhoneFilterFields(state) : null };
}

/**
 * «Готово» и «Сохранить фильтр»: черновик поверх ТЕКУЩЕГО фильтра. Поиск остаётся текущим всегда; на компьютере ещё
 * период, сумма и сортировка; на телефоне их задаёт черновик (снятая в нём граница или сумма снимается и в фильтре).
 */
export function applyFilterDraft(state: JournalUrlState, draft: FilterDraft): JournalUrlState {
  const next = applyDialogFields(state, draft.fields);
  if (!draft.phone) return next;
  delete next.from;
  delete next.to;
  delete next.amountMin;
  delete next.amountMax;
  return { ...next, ...draft.phone };
}

/** «Очистить»: условия окна, на телефоне — ещё период и сумма; сортировка остаётся (как у «Сбросить фильтр»). */
export function clearFilterDraft(draft: FilterDraft): FilterDraft {
  return {
    fields: pickDialogFields(EMPTY_JOURNAL_STATE),
    phone: draft.phone ? { period: 'all', sort: draft.phone.sort, order: draft.phone.order } : null,
  };
}

/** Блок «Ещё условия» открыт при открытии окна: задана сумма или сортировка не «Сначала новые». */
export function phoneMoreSet(f: PhoneFilterFields): boolean {
  return f.amountMin !== undefined || f.amountMax !== undefined || f.sort !== EMPTY_JOURNAL_STATE.sort || f.order !== EMPTY_JOURNAL_STATE.order;
}

/**
 * JSON сохранённого фильтра (journalFilterSchema плана 5a): поля API, период — датами, пустые списки
 * и выключенные флаги не пишутся. Сортировка не сохраняется.
 */
export interface SavedJournalFilter {
  from?: string;
  to?: string;
  q?: string;
  amountMin?: number;
  amountMax?: number;
  types?: OperationType[];
  accountIds?: number[];
  categoryIds?: number[];
  projectIds?: number[];
  counterpartyIds?: number[];
  tagIds?: number[];
  withoutCategory?: true;
  withoutProject?: true;
  withoutCounterparty?: true;
}

/** Текущий фильтр → JSON для сохранения. Относительный период («текущий месяц») сохраняется датами (решение 6 плана 5a). */
export function savedFilterFromState(state: JournalUrlState, today: string): SavedJournalFilter {
  const f: SavedJournalFilter = { ...periodRange(state, today) };
  if (state.q) f.q = state.q;
  if (state.amountMin !== undefined) f.amountMin = state.amountMin;
  if (state.amountMax !== undefined) f.amountMax = state.amountMax;
  if (state.types.length) f.types = [...state.types];
  for (const field of LIST_FIELDS) if (state[field].length) f[field] = [...state[field]];
  for (const field of FLAG_FIELDS) if (state[field]) f[field] = true;
  return f;
}

/** Сохранённый фильтр → фильтр журнала: даты — период «Выбрать даты» (custom), сортировка остаётся текущей. */
export function stateFromSavedFilter(filter: SavedJournalFilter, current: Pick<JournalUrlState, 'sort' | 'order'>): JournalUrlState {
  const state: JournalUrlState = { ...EMPTY_JOURNAL_STATE, sort: current.sort, order: current.order };
  if (filter.from || filter.to) {
    state.period = 'custom';
    if (filter.from) state.from = filter.from;
    if (filter.to) state.to = filter.to;
  }
  if (filter.q) state.q = filter.q;
  if (filter.amountMin !== undefined) state.amountMin = filter.amountMin;
  if (filter.amountMax !== undefined) state.amountMax = filter.amountMax;
  state.types = OPERATION_TYPES.filter((t) => filter.types?.includes(t));
  for (const field of LIST_FIELDS) state[field] = sortedUnique(filter[field] ?? []);
  for (const field of FLAG_FIELDS) state[field] = filter[field] === true;
  return state;
}
