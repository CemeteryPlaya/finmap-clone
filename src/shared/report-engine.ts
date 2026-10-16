import { getCurrency } from './currencies';
import { addDays, formatDateRu, startOfDayUtc } from './dates';
import { convertMinor, type Dec } from './decimal';

/**
 * Движок отчётов «Аналитики» (§3 спецификации «Аналитика»): чистые функции без базы — колонки шага, раскладка строк
 * операций по колонкам, разрезы, остатки и неоперационные изменения. Сервер выбирает строки одним запросом и передаёт сюда.
 */

export type ReportStep = 'day' | 'week' | 'month' | 'quarter';
export type ReportBy = 'category' | 'counterparty' | 'project';
export type LineType = 'income' | 'expense';

export const REPORT_STEPS: readonly ReportStep[] = ['day', 'week', 'month', 'quarter'];
export const REPORT_BYS: readonly ReportBy[] = ['category', 'counterparty', 'project'];
/** Не больше колонок в отчёте (§2.3): дни — около 3 месяцев, недели — около 2 лет. */
export const REPORT_MAX_COLUMNS = 92;
/** Период «Выбрать даты» — не больше 5 лет (§2.3). */
export const REPORT_MAX_YEARS = 5;

/** Колонка отчёта: границы — календарные даты в APP_TIMEZONE включительно; key — дата начала. */
export interface ReportColumn {
  key: string;
  from: string;
  to: string;
  label: string;
}

const MONTHS = ['Январь', 'Февраль', 'Март', 'Апрель', 'Май', 'Июнь', 'Июль', 'Август', 'Сентябрь', 'Октябрь', 'Ноябрь', 'Декабрь'];
const MONTHS_SHORT = ['янв', 'фев', 'мар', 'апр', 'мая', 'июн', 'июл', 'авг', 'сен', 'окт', 'ноя', 'дек'];
const QUARTERS = ['I', 'II', 'III', 'IV'];

const parts = (date: string): [number, number, number] => date.split('-').map(Number) as [number, number, number];
const pad = (n: number) => String(n).padStart(2, '0');
const ymd = (y: number, m: number, d: number) => `${y}-${pad(m)}-${pad(d)}`;

/** Понедельник недели, в которую входит дата. */
export function mondayOf(date: string): string {
  const [y, m, d] = parts(date);
  const weekday = (new Date(Date.UTC(y, m - 1, d)).getUTCDay() + 6) % 7;
  return addDays(date, -weekday);
}

/** Дата + months месяцев; число, которого нет в новом месяце, — последний день месяца (31.01 + 1 → 28.02). */
export function addMonths(date: string, months: number): string {
  const [y, m, d] = parts(date);
  const index = y * 12 + (m - 1) + months;
  const ny = Math.floor(index / 12);
  const nm = (index % 12) + 1;
  const last = new Date(Date.UTC(ny, nm, 0)).getUTCDate();
  return ymd(ny, nm, Math.min(d, last));
}

/** Последний допустимый день периода, начатого с from: не больше 5 лет (§2.3). */
export function maxReportTo(from: string): string {
  return addDays(addMonths(from, REPORT_MAX_YEARS * 12), -1);
}

/** Начало колонки шага, в которую входит дата (без учёта границ периода). */
function stepStart(date: string, step: ReportStep): string {
  const [y, m] = parts(date);
  switch (step) {
    case 'day':
      return date;
    case 'week':
      return mondayOf(date);
    case 'month':
      return ymd(y, m, 1);
    case 'quarter':
      return ymd(y, m - ((m - 1) % 3), 1);
  }
}

function nextStepStart(start: string, step: ReportStep): string {
  switch (step) {
    case 'day':
      return addDays(start, 1);
    case 'week':
      return addDays(start, 7);
    case 'month':
      return addMonths(start, 1);
    case 'quarter':
      return addMonths(start, 3);
  }
}

const dayNumber = (date: string) => {
  const [y, m, d] = parts(date);
  return Date.UTC(y, m - 1, d) / 86_400_000;
};

/** Сколько колонок даст шаг на периоде [from; to] — без построения колонок (проверка ≤ 92). */
export function columnCount(from: string, to: string, step: ReportStep): number {
  if (to < from) return 0;
  const [y1, m1] = parts(from);
  const [y2, m2] = parts(to);
  switch (step) {
    case 'day':
      return dayNumber(to) - dayNumber(from) + 1;
    case 'week':
      return (dayNumber(mondayOf(to)) - dayNumber(mondayOf(from))) / 7 + 1;
    case 'month':
      return (y2 - y1) * 12 + (m2 - m1) + 1;
    case 'quarter':
      return (y2 - y1) * 4 + Math.floor((m2 - 1) / 3) - Math.floor((m1 - 1) / 3) + 1;
  }
}

/** «14 окт»; с годом — «29 дек 2025». */
function shortDay(date: string, withYear: boolean): string {
  const [y, m, d] = parts(date);
  return `${d} ${MONTHS_SHORT[m - 1]}${withYear ? ` ${y}` : ''}`;
}

/** Подпись колонки (§2.3): «14 окт», «13–19 окт», «29 сен – 5 окт», «Октябрь 2026», «IV кв. 2026». */
export function columnLabel(from: string, to: string, step: ReportStep): string {
  const [y, m, d] = parts(from);
  switch (step) {
    case 'day':
      return shortDay(from, false);
    case 'week': {
      if (from === to) return shortDay(from, false);
      const [y2, m2, d2] = parts(to);
      if (y !== y2) return `${shortDay(from, true)} – ${shortDay(to, true)}`;
      if (m !== m2) return `${shortDay(from, false)} – ${shortDay(to, false)}`;
      return `${d}–${d2} ${MONTHS_SHORT[m - 1]}`;
    }
    case 'month':
      return `${MONTHS[m - 1]} ${y}`;
    case 'quarter':
      return `${QUARTERS[Math.floor((m - 1) / 3)]} кв. ${y}`;
  }
}

/**
 * Колонки периода [from; to] по шагу (§2.3): неделя — с понедельника; первая и последняя колонки обрезаются границами
 * периода (неполные недели, месяцы и кварталы). Пустой период (to раньше from) — колонок нет.
 */
export function reportColumns(from: string, to: string, step: ReportStep): ReportColumn[] {
  const columns: ReportColumn[] = [];
  for (let start = stepStart(from, step); start <= to; start = nextStepStart(start, step)) {
    const colFrom = start < from ? from : start;
    const end = addDays(nextStepStart(start, step), -1);
    const colTo = end > to ? to : end;
    columns.push({ key: colFrom, from: colFrom, to: colTo, label: columnLabel(colFrom, colTo, step) });
  }
  return columns;
}

/**
 * Границы колонок — моменты UTC в формате `paidAt` (n + 1 значений): начало первого дня каждой колонки в APP_TIMEZONE
 * и начало дня после последней. Смещение пояса берётся на каждую дату (в Алматы до 01.03.2024 — UTC+6).
 */
export function columnStarts(columns: readonly ReportColumn[], timeZone: string): string[] {
  if (columns.length === 0) return [];
  return [...columns.map((c) => startOfDayUtc(c.from, timeZone)), startOfDayUtc(addDays(columns.at(-1)!.to, 1), timeZone)];
}

/** Индекс колонки момента `at` (ISO UTC) по границам columnStarts; вне периода — -1. Двоичный поиск. */
export function bucketOf(starts: readonly string[], at: string): number {
  const n = starts.length - 1;
  if (n <= 0 || at < starts[0]! || at >= starts[n]!) return -1;
  let lo = 0;
  let hi = n - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (starts[mid]! <= at) lo = mid;
    else hi = mid - 1;
  }
  return lo;
}

/** Строка операции для отчёта (§3.1): сумма — в базовой валюте компании (`operation_lines.base_amount`). */
export interface ReportLine {
  /** `paid_at` операции. */
  at: string;
  type: LineType;
  accountId: number;
  categoryId: number | null;
  projectId: number | null;
  counterpartyId: number | null;
  amount: number;
}

export interface DictCategory {
  id: number;
  kind: LineType;
  parentId: number | null;
  name: string;
  archived: boolean;
}

export interface DictItem {
  id: number;
  name: string;
  archived: boolean;
}

/** Справочники компании в порядке показа (orderIndex, id), включая архивные. */
export interface ReportDicts {
  categories: DictCategory[];
  counterparties: DictItem[];
  projects: DictItem[];
}

/** Фильтр отчёта (§2.4): списки id и «без …»; пустой список — то же, что его отсутствие. */
export interface ReportFilter {
  accountIds?: number[];
  categoryIds?: number[];
  counterpartyIds?: number[];
  projectIds?: number[];
  tagIds?: number[];
  withoutCategory?: boolean;
  withoutCounterparty?: boolean;
  withoutProject?: boolean;
}

export type RowKind = 'group' | 'category' | 'counterparty' | 'project' | 'balance' | 'info';

/** Строка ответа отчёта (§3.2): values — по колонкам, null — значение не считается (нет курса, остатки скрыты). */
export interface ReportRow {
  id: string;
  kind: RowKind;
  label: string;
  values: (number | null)[];
  total: number | null;
  children?: ReportRow[];
  /** Архивная категория, контрагент или проект: показывается, только пока по нему есть суммы. */
  archived?: true;
  /** Пояснение под названием строки: «Нет курса USD на 01.10.2026». */
  note?: string;
}

const has = (xs: readonly number[] | undefined) => !!xs && xs.length > 0;

/** Фильтр не по счетам (категории, контрагенты, проекты, теги) — остатки не считаются (§4.1). */
export function hidesBalances(f: ReportFilter): boolean {
  return has(f.categoryIds) || has(f.counterpartyIds) || has(f.projectIds) || has(f.tagIds) || !!f.withoutCategory || !!f.withoutCounterparty || !!f.withoutProject;
}

const sumOf = (values: readonly (number | null)[]): number | null => (values.some((v) => v === null) ? null : values.reduce<number>((s, v) => s + v!, 0));

/** Суммы строки по колонкам и счётчик строк операций (строка «есть суммы» — даже если сумма 0). */
interface Acc {
  values: number[];
  lines: number;
}

const newAcc = (n: number): Acc => ({ values: new Array<number>(n).fill(0), lines: 0 });

function addTo(map: Map<string, Acc>, key: string, n: number, column: number, amount: number): void {
  let acc = map.get(key);
  if (!acc) {
    acc = newAcc(n);
    map.set(key, acc);
  }
  acc.values[column]! += amount;
  acc.lines++;
}

function row(id: string, kind: RowKind, label: string, values: (number | null)[], extra: Partial<ReportRow> = {}): ReportRow {
  return { id, kind, label, values, total: sumOf(values), ...extra };
}

const plus = (a: readonly number[], b: readonly number[]) => a.map((v, i) => v + b[i]!);

const NONE_LABEL: Record<ReportBy, string> = { category: 'Без категории', counterparty: 'Без контрагента', project: 'Без проекта' };
export const GROUP_LABEL: Record<LineType, string> = { income: 'Поступления', expense: 'Списания' };

/** Ключ строки разреза: id элемента или «none». */
const dimKey = (line: ReportLine, by: ReportBy): string => {
  const id = by === 'category' ? line.categoryId : by === 'counterparty' ? line.counterpartyId : line.projectId;
  return id === null ? 'none' : String(id);
};

/**
 * Строки разреза одной группы (§2.4, §3.3). По категориям — категории верхнего уровня, у каждой подкатегории в children
 * (родитель = свои строки + подкатегории; свои строки при подкатегориях — отдельная «Без подкатегории»). Нулевые строки:
 * при непустом периоде — неархивные категории и проекты, если фильтра по этому же измерению нет (контрагенты — только
 * с суммами). Архивные — только с суммами. «Без …» — если есть строки без значения.
 */
function breakdown(kind: LineType, by: ReportBy, accs: Map<string, Acc>, n: number, dicts: ReportDicts, filter: ReportFilter, empty: boolean): ReportRow[] {
  const prefix = `${kind}:${by}:`;
  const get = (key: string) => accs.get(key);
  const zeroAllowed =
    !empty && (by === 'category' ? !has(filter.categoryIds) && !filter.withoutCategory : by === 'project' ? !has(filter.projectIds) && !filter.withoutProject : false);
  const rows: ReportRow[] = [];
  // ключи, у которых есть место в строках разреза; остальные (не бывает при целостной базе) — строкой «…»
  const covered = new Set<string>();
  if (by === 'category') {
    const own = dicts.categories.filter((c) => c.kind === kind);
    for (const top of own.filter((c) => c.parentId === null)) {
      const children = own.filter((c) => c.parentId === top.id);
      covered.add(String(top.id));
      const childRows: ReportRow[] = [];
      let total = [...(get(String(top.id))?.values ?? new Array<number>(n).fill(0))];
      for (const c of children) {
        covered.add(String(c.id));
        const acc = get(String(c.id));
        if (acc) total = plus(total, acc.values);
        const archived = c.archived || top.archived;
        if (acc || (zeroAllowed && !archived)) {
          childRows.push(row(`${prefix}${c.id}`, 'category', c.name, acc ? acc.values : new Array<number>(n).fill(0), archived ? { archived: true } : {}));
        }
      }
      const self = get(String(top.id));
      if (!self && childRows.length === 0 && !(zeroAllowed && !top.archived)) continue;
      if (self && childRows.length > 0) childRows.unshift(row(`${prefix}${top.id}:own`, 'category', 'Без подкатегории', self.values));
      rows.push(row(`${prefix}${top.id}`, 'category', top.name, total, { ...(top.archived ? { archived: true as const } : {}), ...(childRows.length ? { children: childRows } : {}) }));
    }
  } else {
    const items = by === 'counterparty' ? dicts.counterparties : dicts.projects;
    for (const item of items) {
      covered.add(String(item.id));
      const acc = get(String(item.id));
      if (!acc && !(zeroAllowed && !item.archived)) continue;
      rows.push(row(`${prefix}${item.id}`, by, item.name, acc ? acc.values : new Array<number>(n).fill(0), item.archived ? { archived: true } : {}));
    }
  }
  // значения, которых нет в справочниках, не теряются: итог разреза = итог группы
  for (const [key, acc] of accs) if (key !== 'none' && !covered.has(key)) rows.push(row(`${prefix}${key}`, by, '…', acc.values));
  const none = get('none');
  if (none) rows.push(row(`${prefix}none`, by, NONE_LABEL[by], none.values));
  return rows;
}

/** Группа «Поступления» или «Списания»: итог по колонкам и строки разреза. */
export interface GroupResult {
  row: ReportRow;
  values: number[];
}

/**
 * Раскладка строк операций по колонкам и разрезу (§3.2): возвращает группы «Поступления» и «Списания» со строками разреза.
 * Строки вне периода не учитываются. Пустой период (ни одной строки) — группы без строк разреза.
 */
export function aggregate(input: {
  lines: readonly ReportLine[];
  starts: readonly string[];
  by: ReportBy;
  dicts: ReportDicts;
  filter: ReportFilter;
}): { income: GroupResult; expense: GroupResult; empty: boolean } {
  const n = Math.max(0, input.starts.length - 1);
  const accs: Record<LineType, Map<string, Acc>> = { income: new Map(), expense: new Map() };
  const totals: Record<LineType, number[]> = { income: new Array<number>(n).fill(0), expense: new Array<number>(n).fill(0) };
  let count = 0;
  for (const line of input.lines) {
    const column = bucketOf(input.starts, line.at);
    if (column < 0) continue;
    count++;
    totals[line.type][column]! += line.amount;
    addTo(accs[line.type], dimKey(line, input.by), n, column, line.amount);
  }
  const empty = count === 0;
  const group = (kind: LineType): GroupResult => {
    const children = breakdown(kind, input.by, accs[kind], n, input.dicts, input.filter, empty);
    return { values: totals[kind], row: row(kind, 'group', GROUP_LABEL[kind], totals[kind], children.length ? { children } : {}) };
  };
  return { income: group('income'), expense: group('expense'), empty };
}

/** Счёт в наборе остатков (§4.1): стартовый остаток — в валюте счёта, openedAt — дата открытия. */
export interface BalanceAccount {
  id: number;
  currency: string;
  startingBalance: number;
  openedAt: string;
}

/** Движение по счёту в его валюте: доход +, расход -, перевод — - со счёта списания и + на счёт зачисления. */
export interface AccountLeg {
  at: string;
  accountId: number;
  delta: number;
}

/** Перевод внутри периода: base — сумма списания в базовой валюте (`operations.base_amount`). */
export interface TransferLeg {
  at: string;
  from: number;
  to: number;
  base: number;
}

/** Курс 1 единицы валюты к базовой на дату; null — курса нет. */
export type RateFn = (currency: string, date: string) => Dec | null;

export interface BalanceSeries {
  /** Остатки на границах колонок (n + 1) в базовой валюте; null — нет курса. */
  at: (number | null)[];
  /** Стартовые остатки счетов, открытых в колонке, в базовой валюте. */
  starting: (number | null)[];
  /** Переводы с выбранных счетов и на них (n): + на счёт набора, - со счёта набора. */
  transfers: number[];
  /** Первый недостающий курс — для пояснения «Нет курса {валюта} на {дата}». */
  missing: { currency: string; date: string } | null;
}

/**
 * Дата курса для границы колонки: последний день перед ней (остаток на начало колонки = остаток на конец предыдущей,
 * §4.1), но не позже сегодняшнего — будущих курсов нет.
 */
export function boundaryRateDate(boundaryDay: string, today: string): string {
  const d = addDays(boundaryDay, -1);
  return d > today ? today : d;
}

/**
 * Остатки набора счетов на границах колонок и неоперационные изменения (§4.1). Остаток счёта на начало дня D —
 * стартовый остаток (если счёт открыт раньше D) + движения до этого момента. Суммы одной валюты переводятся в базовую по
 * курсу на дату границы (boundaryRateDate); нулевая сумма валюты курса не требует (как «Всего на счетах»).
 */
export function balanceSeries(input: {
  columns: readonly ReportColumn[];
  starts: readonly string[];
  accounts: readonly BalanceAccount[];
  /** Сумма движений счёта до начала периода, в валюте счёта. */
  opening: ReadonlyMap<number, number>;
  /** Движения внутри периода. */
  legs: readonly AccountLeg[];
  transfers: readonly TransferLeg[];
  baseCurrency: string;
  rate: RateFn;
  today: string;
}): BalanceSeries {
  const n = input.columns.length;
  const baseMinor = getCurrency(input.baseCurrency).minorUnits;
  const days = [...input.columns.map((c) => c.from), n ? addDays(input.columns.at(-1)!.to, 1) : ''];
  const inSet = new Map(input.accounts.map((a) => [a.id, a]));
  // движение по колонкам: перед границей k учитываются колонки 0..k-1
  const flow = new Map<number, number[]>();
  for (const leg of input.legs) {
    if (!inSet.has(leg.accountId)) continue;
    const column = bucketOf(input.starts, leg.at);
    if (column < 0) continue;
    let xs = flow.get(leg.accountId);
    if (!xs) {
      xs = new Array<number>(n).fill(0);
      flow.set(leg.accountId, xs);
    }
    xs[column]! += leg.delta;
  }
  let missing: BalanceSeries['missing'] = null;
  const convert = (sums: Map<string, number>, date: string): number | null => {
    let total = 0;
    for (const [currency, sum] of sums) {
      if (sum === 0) continue;
      if (currency === input.baseCurrency) {
        total += sum;
        continue;
      }
      const r = input.rate(currency, date);
      if (r === null) {
        missing ??= { currency, date };
        return null;
      }
      total += convertMinor(sum, r, getCurrency(currency).minorUnits, baseMinor);
    }
    return total;
  };
  const at: (number | null)[] = [];
  const running = new Map(input.accounts.map((a) => [a.id, input.opening.get(a.id) ?? 0]));
  for (let k = 0; k <= n; k++) {
    if (k > 0) for (const [id, xs] of flow) running.set(id, running.get(id)! + xs[k - 1]!);
    const sums = new Map<string, number>();
    for (const a of input.accounts) {
      const value = running.get(a.id)! + (a.openedAt < days[k]! ? a.startingBalance : 0);
      sums.set(a.currency, (sums.get(a.currency) ?? 0) + value);
    }
    at.push(n ? convert(sums, boundaryRateDate(days[k]!, input.today)) : null);
  }
  const starting = input.columns.map((c, i) => {
    const sums = new Map<string, number>();
    for (const a of input.accounts) if (a.openedAt >= c.from && a.openedAt <= c.to) sums.set(a.currency, (sums.get(a.currency) ?? 0) + a.startingBalance);
    return convert(sums, boundaryRateDate(days[i + 1]!, input.today));
  });
  const transfers = new Array<number>(n).fill(0);
  for (const t of input.transfers) {
    const column = bucketOf(input.starts, t.at);
    if (column < 0) continue;
    if (inSet.has(t.to)) transfers[column]! += t.base;
    if (inSet.has(t.from)) transfers[column]! -= t.base;
  }
  return { at: n ? at : [], starting, transfers, missing };
}

/** Строка «Остатки скрыты» при фильтре не по счетам (§4.1). */
export const HIDDEN_BALANCES_TEXT = 'Остатки скрыты: при фильтре по категориям, контрагентам, проектам или тегам остаток не считается';

export interface CashflowResult {
  rows: ReportRow[];
  empty: boolean;
}

/**
 * Строки отчёта «Деньги» (§4.1): остатки на начало и конец, «Неоперационные изменения остатка» (стартовые остатки,
 * переводы, исключённые из отчёта счета, курсовая разница), «Чистый денежный поток», «Поступления», «Списания».
 * «Курсовая разница» — остаток: конец - начало - чистый поток - остальные неоперационные. «Исключённые из отчёта счета» —
 * минус поток счетов вне набора остатков (архивные счета без фильтра «Счета»). balances: null — остатки скрыты.
 */
export function cashflowRows(input: {
  columns: readonly ReportColumn[];
  starts: readonly string[];
  lines: readonly ReportLine[];
  by: ReportBy;
  dicts: ReportDicts;
  filter: ReportFilter;
  balances: { series: BalanceSeries; accountIds: ReadonlySet<number> } | null;
}): CashflowResult {
  const n = input.columns.length;
  const { income, expense, empty } = aggregate(input);
  const net = income.values.map((v, i) => v - expense.values[i]!);
  const netRow = row('net', 'info', 'Чистый денежный поток', net);
  if (!input.balances) {
    const hidden = row('balance:hidden', 'info', HIDDEN_BALANCES_TEXT, new Array<null>(n).fill(null));
    return { rows: [hidden, netRow, income.row, expense.row], empty };
  }
  const { series, accountIds } = input.balances;
  const excluded = new Array<number>(n).fill(0);
  for (const line of input.lines) {
    if (accountIds.has(line.accountId)) continue;
    const column = bucketOf(input.starts, line.at);
    if (column >= 0) excluded[column]! -= line.type === 'income' ? line.amount : -line.amount;
  }
  const start = series.at.slice(0, n);
  const end = series.at.slice(1);
  const nonop = end.map((e, i) => (e === null || start[i] === null ? null : e - start[i]! - net[i]!));
  const fx = nonop.map((v, i) => (v === null || series.starting[i] === null ? null : v - series.starting[i]! - series.transfers[i]! - excluded[i]!));
  const note = series.missing ? { note: `Нет курса ${series.missing.currency} на ${formatDateRu(series.missing.date)}` } : {};
  const startRow: ReportRow = { ...row('balance:start', 'balance', 'Остаток на начало периода', start, note), total: start[0] ?? null };
  const endRow: ReportRow = { ...row('balance:end', 'balance', 'Остаток на конец периода', end, note), total: end.at(-1) ?? null };
  const nonopRow = row('nonop', 'info', 'Неоперационные изменения остатка', nonop, {
    children: [
      row('nonop:starting', 'info', 'Стартовые остатки', series.starting),
      row('nonop:transfers', 'info', 'Переводы', series.transfers),
      row('nonop:excluded', 'info', 'Исключённые из отчёта счета', excluded),
      row('nonop:fx', 'info', 'Курсовая разница', fx),
    ],
  });
  return { rows: [startRow, endRow, nonopRow, netRow, income.row, expense.row], empty };
}

/** Доля строки в группе (§4.1 «Показать проценты»): «12,50 %»; группа 0 — null. */
export function sharePercent(value: number | null, group: number | null): string | null {
  if (value === null || group === null || group === 0) return null;
  const bp = Math.round((value * 10_000) / group);
  const abs = Math.abs(bp);
  return `${bp < 0 ? '\u2212' : ''}${Math.trunc(abs / 100)},${pad(abs % 100)}\u00A0%`;
}

/** Ячейка, по которой открывается список операций (§2.5): какие строки операций в неё вошли. */
export interface DrillSpec {
  types: LineType[];
  /** null — вся группа или «Чистый денежный поток». */
  dim: ReportBy | null;
  /** id элемента разреза; null — «Без …». */
  id: number | null;
  /** Только сама категория, без подкатегорий («Без подкатегории»). */
  own: boolean;
}

/** id строки отчёта → что в неё входит; строки остатков и неоперационных изменений не раскрываются (null). */
export function parseDrillRow(id: string): DrillSpec | null {
  if (id === 'net') return { types: ['income', 'expense'], dim: null, id: null, own: false };
  if (id === 'income' || id === 'expense') return { types: [id], dim: null, id: null, own: false };
  const m = /^(income|expense):(category|counterparty|project):(none|[1-9]\d{0,14})(:own)?$/.exec(id);
  if (!m || (m[4] && (m[2] !== 'category' || m[3] === 'none'))) return null;
  return { types: [m[1] as LineType], dim: m[2] as ReportBy, id: m[3] === 'none' ? null : Number(m[3]), own: !!m[4] };
}

/** Границы ячейки: колонка по ключу или весь период («total», колонка «Итого»); неизвестный ключ — null. */
export function drillRange(columns: readonly ReportColumn[], col: string): { from: string; to: string } | null {
  if (columns.length === 0) return null;
  if (col === 'total') return { from: columns[0]!.from, to: columns.at(-1)!.to };
  const c = columns.find((x) => x.key === col);
  return c ? { from: c.from, to: c.to } : null;
}
