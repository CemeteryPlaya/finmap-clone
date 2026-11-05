import { isValidDate } from '../../shared/dates';
import { maxReportTo, REPORT_STEPS, type ReportStep } from '../../shared/report-engine';
import { effectiveStep, REPORT_PERIODS, reportRange, type ReportPeriod } from './report-url';

/** Вид отчёта клуба (§2.2, §5.3): «график», «таблица» или «по часам». */
export type ClubView = 'chart' | 'table' | 'hours';
const CLUB_VIEWS: readonly ClubView[] = ['chart', 'table', 'hours'];

/** Настройки отчёта клуба в адресе (спецификация «Аналитика клуба», §2.2): вид, период, шаг, разрез, клуб, сравнение. */
export interface ClubUrlState {
  view: ClubView;
  period: ReportPeriod;
  from?: string;
  to?: string;
  step: ReportStep;
  /** Разрез отчёта; у отчёта без разрезов — ''. */
  by: string;
  /** Клуб — проект шаблона «Компьютерный клуб»; null — «Все клубы». */
  project: number | null;
  compare: boolean;
}

/** Умолчания: «график», «За текущий год», «По месяцам», «Все клубы», сравнение включено; разрез — первый у отчёта. */
export const DEFAULT_CLUB_STATE: ClubUrlState = { view: 'chart', period: 'year', step: 'month', by: '', project: null, compare: true };

const validDate = (v: string | null): v is string => v !== null && isValidDate(v) && v < '9999';

/** Свои даты — только обе; перепутанные меняются местами, период длиннее 5 лет обрезается. */
function customRange(params: URLSearchParams): { from: string; to: string } | null {
  const from = params.get('from');
  const to = params.get('to');
  if (!validDate(from) || !validDate(to)) return null;
  const [a, b] = from <= to ? [from, to] : [to, from];
  const limit = maxReportTo(a);
  return { from: a, to: b > limit ? limit : b };
}

function projectOf(v: string | null): number | null {
  if (v === null || !/^\d{1,15}$/.test(v)) return null;
  const n = Number(v);
  return n > 0 && Number.isSafeInteger(n) ? n : null;
}

/** Адрес → настройки. Разбор мягкий: неверное значение — умолчание, отчёт не падает от ручной правки адреса. */
export function parseClubSearch(params: URLSearchParams, byChoices: readonly string[]): ClubUrlState {
  const state: ClubUrlState = { ...DEFAULT_CLUB_STATE, by: byChoices[0] ?? '' };
  const range = customRange(params);
  const period = params.get('period');
  if (range) Object.assign(state, { period: 'custom', ...range });
  else if (period !== 'custom' && REPORT_PERIODS.includes(period as ReportPeriod)) state.period = period as ReportPeriod;
  const view = params.get('view');
  if (CLUB_VIEWS.includes(view as ClubView)) state.view = view as ClubView;
  const step = params.get('step');
  if (REPORT_STEPS.includes(step as ReportStep)) state.step = step as ReportStep;
  const by = params.get('by');
  if (by !== null && byChoices.includes(by)) state.by = by;
  state.project = projectOf(params.get('project'));
  state.compare = params.get('compare') !== '0';
  return state;
}

/** Период в адресе: свои даты — обе (без них «Выбрать даты» не применён), другой период — ключом, год не пишется. */
function setPeriod(p: URLSearchParams, state: ClubUrlState): void {
  if (state.period !== 'custom') {
    if (state.period !== DEFAULT_CLUB_STATE.period) p.set('period', state.period);
    return;
  }
  if (!state.from || !state.to) return;
  p.set('from', state.from);
  p.set('to', state.to);
}

/** Настройки → адрес: только отличия от умолчаний, в постоянном порядке. */
export function clubSearch(state: ClubUrlState, byChoices: readonly string[]): URLSearchParams {
  const p = new URLSearchParams();
  if (state.view !== DEFAULT_CLUB_STATE.view) p.set('view', state.view);
  setPeriod(p, state);
  if (state.step !== DEFAULT_CLUB_STATE.step) p.set('step', state.step);
  if (state.by !== (byChoices[0] ?? '')) p.set('by', state.by);
  if (state.project !== null) p.set('project', String(state.project));
  if (!state.compare) p.set('compare', '0');
  return p;
}

/** Параметры API отчёта клуба (§11): период датами, действующий шаг, разрез, вид («по часам» или таблица), клуб, сравнение. */
export function clubApiParams(state: ClubUrlState, today: string): URLSearchParams {
  const range = reportRange(state, today);
  const p = new URLSearchParams();
  p.set('from', range.from);
  p.set('to', range.to);
  p.set('step', effectiveStep(state.step, range));
  if (state.by) p.set('by', state.by);
  p.set('view', state.view === 'hours' ? 'hours' : 'table');
  if (state.project !== null) p.set('project', String(state.project));
  p.set('compare', state.compare ? '1' : '0');
  return p;
}

/** Какие контролы отличаются от умолчаний (точки на компьютере, число на «Фильтрах» телефона); шаг — по действующему. */
export function clubChanged(state: ClubUrlState, byChoices: readonly string[], range: { from: string; to: string }) {
  return {
    project: state.project !== null,
    period: state.period !== DEFAULT_CLUB_STATE.period,
    step: effectiveStep(state.step, range) !== DEFAULT_CLUB_STATE.step,
    compare: !state.compare,
    by: state.by !== (byChoices[0] ?? ''),
  };
}

/** Отличия от умолчаний отчёта; у отчёта без шага («Обзор», §4) шаг не считается: его контрола нет. */
export function clubChangedFor(state: ClubUrlState, byValues: readonly string[], range: { from: string; to: string }, stepless?: boolean) {
  const changed = clubChanged(state, byValues, range);
  return stepless ? { ...changed, step: false } : changed;
}

/** Настройки с шагом, который годится для периода: после смены периода «По дням» на годе становится «По неделям». */
export function withClubStep(state: ClubUrlState, today: string): ClubUrlState {
  const step = effectiveStep(state.step, reportRange(state, today));
  return step === state.step ? state : { ...state, step };
}

/** Пункты сравнения (§2.2): подпись кнопки — текущее состояние, как у процентов финансовых отчётов. */
export const COMPARE_CHOICES = [
  { value: 'on', label: 'Сравнить с прошлым периодом', short: 'Сравнение: вкл' },
  { value: 'off', label: 'Без сравнения', short: 'Сравнение: выкл' },
] as const;

/** Пункты «Клуб» (§2.2): «Все клубы» и проекты-клубы без архивных; одного клуба мало для выбора — пунктов нет. */
export function clubChoices(projects: readonly { id: number; name: string; archived: boolean }[]): { value: string; label: string }[] {
  const active = projects.filter((p) => !p.archived);
  if (active.length < 2) return [];
  return [{ value: 'all', label: 'Все клубы' }, ...active.map((p) => ({ value: String(p.id), label: p.name }))];
}

/** Клуб из адреса, которого нет среди клубов (архивный, чужой, удалённый), — «Все клубы». */
export function knownProject(state: ClubUrlState, projects: readonly { id: number; archived: boolean }[]): ClubUrlState {
  return state.project === null || projects.some((p) => p.id === state.project && !p.archived) ? state : { ...state, project: null };
}

/** «Сбросить»: контролы — по умолчанию, вид остаётся (как у финансовых отчётов). */
export function resetClubState(state: ClubUrlState, byChoices: readonly string[]): ClubUrlState {
  return { ...DEFAULT_CLUB_STATE, by: byChoices[0] ?? '', view: state.view };
}
