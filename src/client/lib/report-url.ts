import { isValidDate } from '../../shared/dates';
import { columnCount, maxReportTo, REPORT_BYS, REPORT_MAX_COLUMNS, REPORT_STEPS, type ReportBy, type ReportStep } from '../../shared/report-engine';
import { JOURNAL_LIST_MAX } from '../../shared/schemas/journal';
import { periodRange, sortedUnique, type DialogFields } from './journal-filter';

/** Периоды отчётов (§2.3 спецификации «Аналитика»): как у Finmap, без «За все время», «За сегодня», «За вчера». */
export type ReportPeriod = 'year' | 'lastYear' | 'week' | 'lastWeek' | 'month' | 'lastMonth' | 'custom';
export const REPORT_PERIODS: readonly ReportPeriod[] = ['year', 'lastYear', 'week', 'lastWeek', 'month', 'lastMonth', 'custom'];

/**
 * Настройки отчёта в адресе страницы (§2.2 — улучшение против Finmap): период, разрез, шаг, проценты и фильтр. Списки —
 * по возрастанию без повторов; from и to — только у «Выбрать даты» и всегда оба.
 */
export interface ReportUrlState {
  period: ReportPeriod;
  from?: string;
  to?: string;
  by: ReportBy;
  step: ReportStep;
  percent: boolean;
  accountIds: number[];
  categoryIds: number[];
  projectIds: number[];
  counterpartyIds: number[];
  tagIds: number[];
  withoutCategory: boolean;
  withoutProject: boolean;
  withoutCounterparty: boolean;
}

/** Значения по умолчанию (§2.3, §2.4): «За текущий год», «По категориям», «По месяцам», без процентов, без фильтра. */
export const DEFAULT_REPORT_STATE: ReportUrlState = {
  period: 'year',
  by: 'category',
  step: 'month',
  percent: false,
  accountIds: [],
  categoryIds: [],
  projectIds: [],
  counterpartyIds: [],
  tagIds: [],
  withoutCategory: false,
  withoutProject: false,
  withoutCounterparty: false,
};

/** Ключи адреса для списков и флагов — те же, что у журнала (`?account=5`). */
const LIST_KEYS = { accountIds: 'account', categoryIds: 'category', projectIds: 'project', counterpartyIds: 'counterparty', tagIds: 'tag' } as const;
type ListField = keyof typeof LIST_KEYS;
const LIST_FIELDS = Object.keys(LIST_KEYS) as ListField[];
/** Имена списков в API отчётов (§9). */
const API_LIST = { accountIds: 'accounts', categoryIds: 'categories', projectIds: 'projects', counterpartyIds: 'counterparties', tagIds: 'tags' } as const;
const FLAG_KEYS = { withoutCategory: 'noCategory', withoutProject: 'noProject', withoutCounterparty: 'noCounterparty' } as const;
type FlagField = keyof typeof FLAG_KEYS;
const FLAG_FIELDS = Object.keys(FLAG_KEYS) as FlagField[];

export const BY_LABELS: Record<ReportBy, string> = { category: 'По категориям', counterparty: 'По контрагентам', project: 'По проектам' };
export const STEP_LABELS: Record<ReportStep, string> = { day: 'По дням', week: 'По неделям', month: 'По месяцам', quarter: 'По кварталам' };
/** Подсказка недоступного шага (§2.3). */
export const TOO_MANY_COLUMNS_HINT = 'Слишком много колонок — выберите больший шаг или короче период';

const validDate = (v: string | null): v is string => v !== null && isValidDate(v) && v < '9999';

function ids(values: string[]): number[] {
  return sortedUnique(values.filter((v) => /^\d{1,15}$/.test(v)).map(Number).filter((n) => n > 0 && Number.isSafeInteger(n))).slice(0, JOURNAL_LIST_MAX);
}

/**
 * Адрес → настройки отчёта. Разбор мягкий: неверные значения — по умолчанию; у своих дат недостающая граница берётся
 * равной другой, перепутанные меняются местами, период длиннее 5 лет обрезается — отчёт не падает от ручной правки адреса.
 */
export function parseReportSearch(params: URLSearchParams): ReportUrlState {
  const state: ReportUrlState = { ...DEFAULT_REPORT_STATE };
  const period = params.get('period');
  let from = params.get('from');
  let to = params.get('to');
  if (!validDate(from)) from = null;
  if (!validDate(to)) to = null;
  if (period === 'custom' || from || to) {
    if (from || to) {
      let a = from ?? to!;
      let b = to ?? from!;
      if (a > b) [a, b] = [b, a];
      const limit = maxReportTo(a);
      state.period = 'custom';
      state.from = a;
      state.to = b > limit ? limit : b;
    }
  } else if (REPORT_PERIODS.includes(period as ReportPeriod)) {
    state.period = period as ReportPeriod;
  }
  const by = params.get('by');
  if (REPORT_BYS.includes(by as ReportBy)) state.by = by as ReportBy;
  const step = params.get('step');
  if (REPORT_STEPS.includes(step as ReportStep)) state.step = step as ReportStep;
  state.percent = params.get('pct') === '1';
  for (const field of LIST_FIELDS) state[field] = ids(params.getAll(LIST_KEYS[field]));
  for (const field of FLAG_FIELDS) state[field] = params.get(FLAG_KEYS[field]) === '1';
  return state;
}

/** Настройки → адрес: только отличия от значений по умолчанию, в постоянном порядке. */
export function reportSearch(state: ReportUrlState): URLSearchParams {
  const p = new URLSearchParams();
  if (state.period === 'custom' && state.from && state.to) {
    p.set('from', state.from);
    p.set('to', state.to);
  } else if (state.period !== 'custom' && state.period !== DEFAULT_REPORT_STATE.period) p.set('period', state.period);
  if (state.by !== DEFAULT_REPORT_STATE.by) p.set('by', state.by);
  if (state.step !== DEFAULT_REPORT_STATE.step) p.set('step', state.step);
  if (state.percent) p.set('pct', '1');
  for (const field of LIST_FIELDS) for (const id of state[field]) p.append(LIST_KEYS[field], String(id));
  for (const field of FLAG_FIELDS) if (state[field]) p.set(FLAG_KEYS[field], '1');
  return p;
}

/** Границы периода отчёта (включительно) от сегодняшней даты в APP_TIMEZONE; неделя — с понедельника. */
export function reportRange(state: Pick<ReportUrlState, 'period' | 'from' | 'to'>, today: string): { from: string; to: string } {
  const r = periodRange(state, today);
  return { from: r.from ?? today, to: r.to ?? r.from ?? today };
}

/** Пункты меню шага: шаг, который даёт больше 92 колонок, недоступен с подсказкой (§2.3). */
export function stepChoices(range: { from: string; to: string }): { value: ReportStep; label: string; disabled?: string }[] {
  return REPORT_STEPS.map((step) =>
    columnCount(range.from, range.to, step) > REPORT_MAX_COLUMNS ? { value: step, label: STEP_LABELS[step], disabled: TOO_MANY_COLUMNS_HINT } : { value: step, label: STEP_LABELS[step] },
  );
}

/** Шаг, который реально строится: выбранный, а если он даёт больше 92 колонок — ближайший больший. */
export function effectiveStep(step: ReportStep, range: { from: string; to: string }): ReportStep {
  const start = REPORT_STEPS.indexOf(step);
  return REPORT_STEPS.slice(start).find((s) => columnCount(range.from, range.to, s) <= REPORT_MAX_COLUMNS) ?? 'quarter';
}

/** Настройки с шагом, который годится для периода (после смены периода «По дням» на годе становится «По неделям»). */
export function withFittingStep(state: ReportUrlState, today: string): ReportUrlState {
  const step = effectiveStep(state.step, reportRange(state, today));
  return step === state.step ? state : { ...state, step };
}

/** Параметры API отчёта (§9): период датами, шаг, разрез и фильтр; списки — повтором ключа, флаги — `true`. */
export function reportApiParams(state: ReportUrlState, today: string): URLSearchParams {
  const range = reportRange(state, today);
  const p = new URLSearchParams();
  p.set('from', range.from);
  p.set('to', range.to);
  p.set('step', effectiveStep(state.step, range));
  p.set('by', state.by);
  for (const field of LIST_FIELDS) for (const id of state[field]) p.append(API_LIST[field], String(id));
  for (const field of FLAG_FIELDS) if (state[field]) p.set(field, 'true');
  return p;
}

/** Сколько измерений фильтра задано (счётчик кнопки «Фильтр»). */
export function reportFilterCount(state: ReportUrlState): number {
  return [
    state.accountIds.length > 0,
    state.categoryIds.length > 0 || state.withoutCategory,
    state.projectIds.length > 0 || state.withoutProject,
    state.counterpartyIds.length > 0 || state.withoutCounterparty,
    state.tagIds.length > 0,
  ].filter(Boolean).length;
}

/** Какие контролы отличаются от значений по умолчанию (§2.2): у них точка; хоть один — «Сбросить». */
export function changedControls(state: ReportUrlState): { period: boolean; by: boolean; step: boolean; percent: boolean; filter: boolean } {
  return {
    period: state.period !== DEFAULT_REPORT_STATE.period,
    by: state.by !== DEFAULT_REPORT_STATE.by,
    step: state.step !== DEFAULT_REPORT_STATE.step,
    percent: state.percent !== DEFAULT_REPORT_STATE.percent,
    filter: reportFilterCount(state) > 0,
  };
}

export function isReportChanged(state: ReportUrlState): boolean {
  return Object.values(changedControls(state)).some(Boolean);
}

/** Своё значение «Выбрать даты» (§2.3): обе даты, не больше 5 лет; иначе текст ошибки. */
export function customRangeError(range: { from?: string; to?: string }): string | null {
  if (!range.from || !range.to) return 'Укажите обе даты';
  const [a, b] = range.from <= range.to ? [range.from, range.to] : [range.to, range.from];
  return b > maxReportTo(a) ? 'Период больше 5 лет' : null;
}

/** Поля окна «Фильтр» из настроек отчёта: типов у отчётов нет. */
export function reportDialogFields(state: ReportUrlState): DialogFields {
  return {
    types: [],
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

/** Настройки отчёта с полями окна «Фильтр» (период, разрез, шаг и проценты — прежние). */
export function withDialogFields(state: ReportUrlState, f: DialogFields): ReportUrlState {
  return {
    ...state,
    accountIds: f.accountIds,
    categoryIds: f.categoryIds,
    projectIds: f.projectIds,
    counterpartyIds: f.counterpartyIds,
    tagIds: f.tagIds,
    withoutCategory: f.withoutCategory,
    withoutProject: f.withoutProject,
    withoutCounterparty: f.withoutCounterparty,
  };
}
