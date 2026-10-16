import { describe, expect, it } from 'vitest';
import {
  BY_CHOICES,
  changedControls,
  customRangeError,
  dropUnknownIds,
  reportDialogFields,
  withDialogFields,
  DEFAULT_REPORT_STATE,
  effectiveStep,
  isReportChanged,
  parseReportSearch,
  PERCENT_CHOICES,
  phoneReportCount,
  REPORT_PERIODS,
  reportApiParams,
  reportFilterCount,
  reportRange,
  reportSearch,
  resetReportState,
  stepChoices,
  usesIds,
  withFittingStep,
  type KnownIds,
  type ReportUrlState,
} from '../../src/client/lib/report-url';

const parse = (qs: string) => parseReportSearch(new URLSearchParams(qs));
const TODAY = '2026-10-16';

describe('настройки отчёта в адресе (§2.2)', () => {
  it('пустой адрес — значения по умолчанию: текущий год, по категориям, по месяцам, без процентов и фильтра', () => {
    expect(parse('')).toEqual(DEFAULT_REPORT_STATE);
    expect(reportSearch(DEFAULT_REPORT_STATE).toString()).toBe('');
    expect(isReportChanged(DEFAULT_REPORT_STATE)).toBe(false);
  });

  it('вид «график / таблица»: по умолчанию график; в адресе только view=table первым; не изменённый контрол; «Сбросить» вид оставляет', () => {
    expect(DEFAULT_REPORT_STATE.view).toBe('chart');
    expect(parse('view=table').view).toBe('table');
    expect(parse('view=pie').view).toBe('chart');
    const s: ReportUrlState = { ...DEFAULT_REPORT_STATE, view: 'table', period: 'month', percent: true };
    expect(reportSearch(s).toString()).toBe('view=table&period=month&pct=1');
    expect(parse(reportSearch(s).toString())).toEqual(s);
    const tableOnly: ReportUrlState = { ...DEFAULT_REPORT_STATE, view: 'table' };
    expect(isReportChanged(tableOnly)).toBe(false);
    expect(phoneReportCount(tableOnly)).toBe(0);
    expect(resetReportState(s)).toEqual(tableOnly);
    expect(reportApiParams(s, TODAY).has('view')).toBe(false);
  });

  it('проценты считаются изменением только в таблице: в виде «график» контрола нет, pct=1 в адресе не даёт «Сбросить» и число на телефоне', () => {
    const range = { from: '2026-01-01', to: '2026-12-31' };
    const chart: ReportUrlState = { ...DEFAULT_REPORT_STATE, percent: true };
    const table: ReportUrlState = { ...chart, view: 'table' };
    expect(changedControls(chart, range).percent).toBe(false);
    expect(isReportChanged(chart, range)).toBe(false);
    expect(phoneReportCount(chart, range)).toBe(0);
    expect(changedControls(table, range).percent).toBe(true);
    expect(isReportChanged(table, range)).toBe(true);
    expect(phoneReportCount(table, range)).toBe(1);
    // действующий шаг (R18) считается в обоих видах
    expect(phoneReportCount({ ...chart, step: 'quarter' }, range)).toBe(1);
    expect(phoneReportCount({ ...table, step: 'quarter' }, range)).toBe(2);
    // сам pct остаётся в адресе: возврат в таблицу восстанавливает проценты
    expect(reportSearch(chart).toString()).toBe('pct=1');
  });

  it('туда и обратно: адрес → настройки → тот же адрес для любых сочетаний', () => {
    const states: ReportUrlState[] = [
      { ...DEFAULT_REPORT_STATE, period: 'lastMonth', by: 'project', step: 'week', percent: true },
      { ...DEFAULT_REPORT_STATE, period: 'custom', from: '2026-01-15', to: '2026-03-10', step: 'day' },
      { ...DEFAULT_REPORT_STATE, accountIds: [2, 5], categoryIds: [7], counterpartyIds: [3], projectIds: [1], tagIds: [9], withoutCategory: true, withoutProject: true, withoutCounterparty: true },
    ];
    for (const s of states) {
      const qs = reportSearch(s).toString();
      expect(parse(qs)).toEqual(s);
      expect(reportSearch(parse(qs)).toString()).toBe(qs);
    }
    expect(reportSearch(states[0]!).toString()).toBe('period=lastMonth&by=project&step=week&pct=1');
    expect(reportSearch(states[1]!).toString()).toBe('from=2026-01-15&to=2026-03-10&step=day');
    expect(reportSearch(states[2]!).toString()).toBe('account=2&account=5&category=7&project=1&counterparty=3&tag=9&noCategory=1&noProject=1&noCounterparty=1');
  });

  it('мягкий разбор: мусор — по умолчанию, перепутанные даты меняются, одна дата — обе, длиннее 5 лет — обрезается', () => {
    expect(parse('period=all&by=tag&step=year&pct=yes&account=x&account=0&account=3&account=3')).toEqual({ ...DEFAULT_REPORT_STATE, accountIds: [3] });
    expect(parse('from=2026-03-10&to=2026-01-15')).toMatchObject({ period: 'custom', from: '2026-01-15', to: '2026-03-10' });
    expect(parse('from=2026-03-10')).toMatchObject({ period: 'custom', from: '2026-03-10', to: '2026-03-10' });
    expect(parse('period=custom&to=2026-02-30')).toMatchObject({ period: 'year' });
    expect(parse('from=2020-01-01&to=2026-12-31')).toMatchObject({ from: '2020-01-01', to: '2024-12-31' });
    expect(REPORT_PERIODS).toEqual(['year', 'lastYear', 'week', 'lastWeek', 'month', 'lastMonth', 'custom']);
  });

  it('границы периода от сегодняшней даты; неделя — с понедельника', () => {
    expect(reportRange({ period: 'year' }, TODAY)).toEqual({ from: '2026-01-01', to: '2026-12-31' });
    expect(reportRange({ period: 'lastYear' }, TODAY)).toEqual({ from: '2025-01-01', to: '2025-12-31' });
    expect(reportRange({ period: 'week' }, TODAY)).toEqual({ from: '2026-10-12', to: '2026-10-18' });
    expect(reportRange({ period: 'lastMonth' }, TODAY)).toEqual({ from: '2026-09-01', to: '2026-09-30' });
    expect(reportRange({ period: 'custom', from: '2026-02-01', to: '2026-02-10' }, TODAY)).toEqual({ from: '2026-02-01', to: '2026-02-10' });
  });
});

describe('шаг и предел 92 колонки (§2.3)', () => {
  it('на годе «По дням» недоступен с подсказкой, недели — доступны', () => {
    const choices = stepChoices({ from: '2026-01-01', to: '2026-12-31' });
    expect(choices.map((c) => [c.label, c.disabled ?? null])).toEqual([
      ['По дням', 'Слишком много колонок — выберите больший шаг или короче период'],
      ['По неделям', null],
      ['По месяцам', null],
      ['По кварталам', null],
    ]);
    // ровно 92 дня — можно, 93 — нет
    expect(stepChoices({ from: '2026-01-01', to: '2026-04-02' })[0]!.disabled).toBeUndefined();
    expect(stepChoices({ from: '2026-01-01', to: '2026-04-03' })[0]!.disabled).toBeDefined();
  });

  it('недоступный шаг заменяется ближайшим большим: в запросе API и после смены периода', () => {
    expect(effectiveStep('day', { from: '2026-01-01', to: '2026-12-31' })).toBe('week');
    expect(effectiveStep('week', { from: '2022-01-01', to: '2026-12-31' })).toBe('month');
    expect(effectiveStep('month', { from: '2026-10-01', to: '2026-10-31' })).toBe('month');
    const daily = { ...DEFAULT_REPORT_STATE, period: 'month' as const, step: 'day' as const };
    expect(reportApiParams(daily, TODAY).get('step')).toBe('day');
    expect(withFittingStep({ ...daily, period: 'year' }, TODAY).step).toBe('week');
    expect(reportApiParams({ ...daily, period: 'year' }, TODAY).get('step')).toBe('week');
  });
});

describe('параметры API и изменённые контролы', () => {
  it('API: период датами, шаг, разрез, списки — повтором ключа, флаги — true', () => {
    const s: ReportUrlState = { ...DEFAULT_REPORT_STATE, by: 'counterparty', accountIds: [1, 2], tagIds: [4], withoutProject: true };
    expect(reportApiParams(s, TODAY).toString()).toBe('from=2026-01-01&to=2026-12-31&step=month&by=counterparty&accounts=1&accounts=2&tags=4&withoutProject=true');
  });

  it('точки у изменённых контролов и счётчик фильтра', () => {
    const s: ReportUrlState = { ...DEFAULT_REPORT_STATE, view: 'table', step: 'quarter', percent: true, categoryIds: [1], withoutCategory: true, tagIds: [2] };
    expect(changedControls(s)).toEqual({ period: false, by: false, step: true, percent: true, filter: true });
    expect(reportFilterCount(s)).toBe(2);
    expect(isReportChanged(s)).toBe(true);
    expect(isReportChanged({ ...DEFAULT_REPORT_STATE, withoutCounterparty: true })).toBe(true);
  });

  it('поля окна «Фильтр»: без типов; применяются поверх периода, разреза, шага и процентов', () => {
    const s: ReportUrlState = { ...DEFAULT_REPORT_STATE, period: 'month', by: 'project', step: 'week', percent: true, tagIds: [3], withoutProject: true };
    const fields = reportDialogFields(s);
    expect(fields).toEqual({ types: [], accountIds: [], categoryIds: [], projectIds: [], counterpartyIds: [], tagIds: [3], withoutCategory: false, withoutProject: true, withoutCounterparty: false });
    expect(withDialogFields(s, { ...fields, tagIds: [], categoryIds: [7], types: ['income'] })).toEqual({ ...s, tagIds: [], categoryIds: [7] });
  });

  it('телефон: число на «Фильтрах» — изменённые период, разрез, шаг, проценты и измерения фильтра; пункты меню', () => {
    expect(phoneReportCount(DEFAULT_REPORT_STATE)).toBe(0);
    expect(phoneReportCount({ ...DEFAULT_REPORT_STATE, view: 'table', period: 'month', by: 'project', percent: true, accountIds: [1], withoutCounterparty: true })).toBe(5);
    expect(BY_CHOICES.map((c) => c.label)).toEqual(['По категориям', 'По контрагентам', 'По проектам']);
    expect(PERCENT_CHOICES.map((c) => c.label)).toEqual(['Скрыть проценты', 'Показать проценты']);
  });

  it('действующий шаг (R18): точка у «Шага» и число на телефоне считаются по шагу, который реально строится', () => {
    // пять лет по неделям — 261 колонка, больше 92: действует «По месяцам», то есть шаг по умолчанию
    const range = { from: '2022-01-01', to: '2026-12-31' };
    const fromUrl: ReportUrlState = { ...DEFAULT_REPORT_STATE, period: 'custom', from: range.from, to: range.to, step: 'week' };
    expect(effectiveStep('week', range)).toBe('month');
    // без периода шаг сравнивается как записан в адресе, с периодом — по действующему
    expect(changedControls(fromUrl).step).toBe(true);
    expect(changedControls(fromUrl, range).step).toBe(false);
    // период изменён (+1), шаг на деле нет: то же число, что показывает компьютер (точка только у периода)
    expect(phoneReportCount(fromUrl)).toBe(2);
    expect(phoneReportCount(fromUrl, range)).toBe(1);
    // «По дням» на годе заменяется «По неделям» — не шаг по умолчанию, это изменение
    expect(isReportChanged({ ...DEFAULT_REPORT_STATE, step: 'day' }, { from: '2026-01-01', to: '2026-12-31' })).toBe(true);
    expect(isReportChanged({ ...DEFAULT_REPORT_STATE, step: 'week' }, range)).toBe(false);
    // «По дням» на коротком периоде действует как есть — это изменение; «По кварталам» на году тоже
    expect(changedControls({ ...DEFAULT_REPORT_STATE, step: 'day' }, { from: '2026-01-01', to: '2026-02-28' }).step).toBe(true);
    const year = { from: '2026-01-01', to: '2026-12-31' };
    expect(phoneReportCount({ ...DEFAULT_REPORT_STATE, step: 'quarter' }, year)).toBe(1);
    expect(phoneReportCount({ ...DEFAULT_REPORT_STATE, view: 'table', step: 'day', percent: true }, year)).toBe(2);
  });

  it('id из адреса, которых нет в справочниках, убираются с названиями списков (R14); нечего убирать — тот же объект', () => {
    const known: KnownIds = {
      accountIds: new Set([1, 2]),
      categoryIds: new Set([10]),
      projectIds: new Set(),
      counterpartyIds: new Set([5]),
      tagIds: new Set([7]),
    };
    const clean: ReportUrlState = { ...DEFAULT_REPORT_STATE, accountIds: [1, 2], categoryIds: [10], counterpartyIds: [5] };
    expect(dropUnknownIds(clean, known)).toEqual({ state: clean, dropped: [] });
    expect(dropUnknownIds(clean, known).state).toBe(clean);
    const bad: ReportUrlState = { ...clean, accountIds: [1, 99], projectIds: [3], tagIds: [7, 8], percent: true, withoutCategory: true };
    const r = dropUnknownIds(bad, known);
    expect(r.dropped).toEqual(['счета', 'проекты', 'теги']);
    expect(r.state).toEqual({ ...bad, accountIds: [1], projectIds: [], tagIds: [7] });
    // всё, что не относится к спискам, остаётся
    expect(r.state.percent).toBe(true);
    expect(r.state.withoutCategory).toBe(true);
    expect(usesIds(DEFAULT_REPORT_STATE)).toBe(false);
    expect(usesIds({ ...DEFAULT_REPORT_STATE, withoutCategory: true })).toBe(false);
    expect(usesIds({ ...DEFAULT_REPORT_STATE, tagIds: [1] })).toBe(true);
  });

  it('свои даты: обе обязательны, не больше 5 лет', () => {
    expect(customRangeError({ from: '2026-01-01' })).toBe('Укажите обе даты');
    expect(customRangeError({ from: '2022-01-01', to: '2026-12-31' })).toBeNull();
    expect(customRangeError({ from: '2022-01-01', to: '2027-01-01' })).toBe('Период больше 5 лет');
    expect(customRangeError({ from: '2027-01-01', to: '2022-01-01' })).toBe('Период больше 5 лет');
  });
});
