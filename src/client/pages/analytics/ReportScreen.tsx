import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import { todayInTimezone } from '../../../shared/dates';
import { ChangedMark, ChoiceMenu } from '../../components/analytics/ChoiceMenu';
import { ReportCharts } from '../../components/analytics/ReportCharts';
import { ReportFilterDialog } from '../../components/analytics/ReportFilterDialog';
import { ReportOperations } from '../../components/analytics/ReportOperations';
import { cellKey, ReportTable } from '../../components/analytics/ReportTable';
import { ViewSwitch } from '../../components/analytics/ViewSwitch';
import type { BarsLineNames } from '../../components/charts/BarsLineChart';
import { HelpButton } from '../../components/HelpButton';
import { FunnelIcon, RefreshIcon } from '../../components/icons';
import type { JournalLookups } from '../../components/journal/JournalTable';
import { PeriodMenu } from '../../components/journal/PeriodMenu';
import { Pending, StaleNotice } from '../../components/QueryState';
import { btnSecondary } from '../../components/ui';
import { useReport, type ReportKind } from '../../lib/analytics';
import type { JournalColumnId } from '../../lib/journal-columns';
import { periodLabel } from '../../lib/journal-filter';
import { categoryLookup } from '../../lib/journal-format';
import { useIsMobile } from '../../lib/media';
import { useMeta } from '../../lib/query';
import { useAccounts, useCategories, useCounterparties, useProjects, useTags, type Company } from '../../lib/queries';
import { cellTitle, DEFAULT_EXPANDED } from '../../lib/report-table';
import {
  BY_CHOICES,
  changedControls,
  customRangeError,
  dropUnknownIds,
  effectiveStep,
  parseReportSearch,
  PERCENT_CHOICES,
  phoneReportCount,
  REPORT_PERIODS,
  reportApiParams,
  reportFilterCount,
  reportRange,
  reportSearch,
  resetReportState,
  STEP_LABELS,
  stepChoices,
  usesIds,
  withFittingStep,
  type KnownIds,
  type ReportUrlState,
} from '../../lib/report-url';

/** Отчёт с таблицей и графиками («Деньги», «Прибыль»): тексты страницы и подписи групп. */
export interface ReportConfig {
  report: ReportKind;
  title: string;
  subtitle: string;
  help: string;
  /** Тип даты над списком периодов (§2.3). */
  dateHeading: string;
  /** Подписи групп и линии графика: «Поступления», «Списания», «Сальдо». */
  names: BarsLineNames;
}

/** Колонки списков под графиками (§4.2): две колонки рядом — без счёта и проекта. */
const CHART_COLUMNS: readonly JournalColumnId[] = ['date', 'amount', 'counterparty', 'category', 'comment'];

/**
 * Страница отчёта (§2.2 спецификации «Аналитика»): заголовок с видом «график / таблица», панель контролов (период, разрез,
 * шаг, «Фильтр», проценты в таблице, «Сбросить», справа «Обновить» и «?»), вид «график» (§4.2) или «таблица» (§4.1) и
 * операции под ними (§2.5). Настройки — в адресе. Экран создаётся заново при смене компании (key у страницы).
 */
export function ReportScreen({ company, config }: { company: Company; config: ReportConfig }) {
  const meta = useMeta();
  const [params, setParams] = useSearchParams();
  const accounts = useAccounts(company.id);
  const categories = useCategories(company.id);
  const projects = useProjects(company.id);
  const counterparties = useCounterparties(company.id);
  const tags = useTags(company.id);
  const parsed = useMemo(() => parseReportSearch(params), [params]);
  // id из адреса, которых нет в справочниках (удалённый счёт, чужая ссылка), убираются из настроек до запроса — иначе 400 без выхода (R14)
  const cleaned = useMemo(() => {
    if (!accounts.data || !categories.data || !projects.data || !counterparties.data || !tags.data) return null;
    const known: KnownIds = {
      accountIds: new Set(accounts.data.map((x) => x.id)),
      categoryIds: new Set(categoryLookup(categories.data).keys()),
      projectIds: new Set(projects.data.map((x) => x.id)),
      counterpartyIds: new Set(counterparties.data.map((x) => x.id)),
      tagIds: new Set(tags.data.map((x) => x.id)),
    };
    return dropUnknownIds(parsed, known);
  }, [parsed, accounts.data, categories.data, projects.data, counterparties.data, tags.data]);
  const state = cleaned?.state ?? parsed;
  const timeZone = meta.data?.timezone;
  const today = timeZone ? todayInTimezone(timeZone) : null;
  // с id в адресе отчёт запрашивается, когда справочники загружены и id проверены
  const apiParams = today && (cleaned || !usesIds(parsed)) ? reportApiParams(state, today).toString() : null;
  const report = useReport(company.id, config.report, apiParams);
  const [notice, setNotice] = useState('');
  useEffect(() => {
    if (!cleaned || cleaned.dropped.length === 0) return;
    setNotice(`Из ссылки убраны фильтры, которых больше нет: ${cleaned.dropped.join(', ')}`);
    setParams(reportSearch(cleaned.state), { replace: true });
    // адрес исправляется один раз на каждую испорченную ссылку; setParams меняется вместе с адресом
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cleaned]);
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(() => new Set(DEFAULT_EXPANDED));
  const headingRef = useRef<HTMLHeadingElement>(null);
  const periodOpsRef = useRef<HTMLHeadingElement>(null);
  const periodOpsId = useId();
  // итог для программ чтения: объявляется, когда пришёл новый ответ (не прежняя таблица, оставленная до ответа)
  const [announcement, setAnnouncement] = useState('');
  const fresh = report.data && !report.isPlaceholderData ? report.data : null;
  const freshStamp = fresh ? report.dataUpdatedAt : 0;
  const freshStep = fresh?.meta.step;
  const freshPeriod = periodLabel(state);
  useEffect(() => {
    if (!freshStamp || !freshStep) return;
    // сначала пусто, спустя 100 мс — текст: пустая область успевает обновиться отдельной задачей, и тот же текст
    // (смена разреза, «Обновить») объявляется снова
    setAnnouncement('');
    const timer = setTimeout(() => setAnnouncement(`Отчёт обновлён: ${freshPeriod}, ${STEP_LABELS[freshStep].toLowerCase()}`), 100);
    return () => clearTimeout(timer);
    // период в подписи — тот, для которого пришёл ответ: смена настроек без ответа ничего не объявляет
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [freshStamp]);
  const mobile = useIsMobile();
  // окно «Фильтры»: на телефоне в нём ещё контролы отчёта (§2.2); режим запоминается при открытии
  const [filterOpen, setFilterOpen] = useState<false | 'phone' | 'desktop'>(false);
  // ячейка таблицы, по которой открыт список операций (§2.5); заголовок и настройки отчёта запоминаются при щелчке
  const [opened, setCell] = useState<{ row: string; col: string; title: string; apiParams: string | null } | null>(null);
  // колонка графика, по которой показаны операции под графиками (§4.2); null — весь период
  const [picked, setPicked] = useState<{ col: string; apiParams: string | null } | null>(null);
  // другие настройки отчёта — прежняя ячейка и колонка к ним не относятся: список закрывается и не показывается под новым отчётом
  const cell = opened && opened.apiParams === apiParams ? opened : null;
  const chartCol = picked && picked.apiParams === apiParams ? picked.col : null;
  useEffect(() => {
    setCell(null);
    setPicked(null);
  }, [apiParams, state.view]);
  const lookups = useMemo<JournalLookups | null>(() => {
    if (!accounts.data || !categories.data || !projects.data || !counterparties.data) return null;
    return {
      accounts: new Map(accounts.data.map((a) => [a.id, a])),
      categories: categoryLookup(categories.data),
      projects: new Map(projects.data.map((p) => [p.id, p.name])),
      counterparties: new Map(counterparties.data.map((c) => [c.id, c.name])),
    };
  }, [accounts.data, categories.data, projects.data, counterparties.data]);

  // настройки меняют адрес без новой записи в истории: «Назад» уводит со страницы, а не по шагам настроек
  const update = (next: ReportUrlState) => {
    setNotice('');
    setParams(reportSearch(next), { replace: true });
  };
  const range = today ? reportRange(state, today) : null;
  // точка у «Шага» — по действующему шагу: из адреса можно получить шаг, который на этом периоде заменяется другим
  const step = range ? effectiveStep(state.step, range) : state.step;
  const changed = changedControls(state, range ?? undefined);
  const phoneCount = phoneReportCount(state, range ?? undefined);
  const table = state.view === 'table';
  // область есть, пока справочники загружены или нет, и пуста до первого ответа: первое объявление тоже читается (как «итог выделения» журнала)
  const status = (
    <p role="status" aria-live="polite" className="sr-only">
      {announcement}
    </p>
  );

  const refresh = (size: string) => (
    <button
      type="button"
      aria-label="Обновить"
      title="Обновить"
      onClick={() => void report.refetch()}
      className={`grid ${size} shrink-0 place-items-center rounded-full bg-field text-ink hover:brightness-95 focus-visible:outline-2 focus-visible:outline-focus`}
    >
      <RefreshIcon spinning={report.isFetching} />
    </button>
  );

  const help = <HelpButton about={config.title} text={config.help} />;

  const header = (
    <div className="mb-4 flex items-start gap-3">
      <Link
        to={`/c/${company.id}/analytics`}
        aria-label="Назад к отчётам"
        title="Назад к отчётам"
        className="grid size-10 shrink-0 place-items-center rounded-full text-xl hover:bg-field focus-visible:outline-2 focus-visible:outline-focus"
      >
        <span aria-hidden="true">←</span>
      </Link>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <h1 ref={headingRef} tabIndex={-1} className="text-2xl font-bold outline-none">
            {config.title}
          </h1>
          {/* компьютер: вид рядом с заголовком, как у Finmap (R7); «?» там уходит вправо панели, на телефоне остаётся у заголовка */}
          <div className="ml-2 max-md:hidden">
            <ViewSwitch value={state.view} onChange={(view) => update({ ...state, view })} />
          </div>
          <span className="contents md:hidden">{help}</span>
        </div>
        <p className="text-sm text-muted">{config.subtitle}</p>
      </div>
    </div>
  );

  const dictionaries = [meta, accounts, categories, projects, counterparties, tags];
  if (!today || !range || !timeZone || !lookups || !tags.data) {
    return (
      <section>
        {header}
        {status}
        {/* «?» компьютера живёт в панели; пока панели нет — под заголовком */}
        <div className="mb-2 flex justify-end max-md:hidden">{help}</div>
        <Pending queries={dictionaries} />
      </section>
    );
  }
  const closeCell = () => {
    const key = cell && cellKey(cell.row, cell.col);
    setCell(null);
    // фокус — в ячейку, из которой открыли список (если она ещё в таблице), иначе на заголовок отчёта
    requestAnimationFrame(() => (document.querySelector<HTMLElement>(`[data-cell="${CSS.escape(key ?? '')}"]`) ?? headingRef.current)?.focus());
  };
  const cellParams = (c: { row: string; col: string }) => {
    const p = new URLSearchParams(apiParams ?? '');
    p.set('report', config.report);
    p.set('row', c.row);
    p.set('col', c.col);
    return p.toString();
  };

  const pickedColumn = chartCol === null ? null : (report.data?.columns.find((c) => c.key === chartCol) ?? null);
  const periodTitle = (label: string) => cellTitle({ id: '', kind: 'info', label, values: [], total: null }, pickedColumn);

  return (
    <section>
      {header}
      {status}
      {/* панель контролов прилипает к верху при прокрутке (§2.2); на телефоне сверху вид, «Фильтры» и «Обновить», остальное — в окне */}
      <div className="sticky top-0 z-20 -mx-4 mb-4 flex flex-wrap items-center gap-2 bg-card px-4 py-2 md:-mx-8 md:px-8">
        <span className="contents md:hidden">
          <ViewSwitch phone value={state.view} onChange={(view) => update({ ...state, view })} />
        </span>
        {/* телефон: число изменённых настроек вместо точек */}
        <button
          type="button"
          aria-haspopup="dialog"
          onClick={() => setFilterOpen('phone')}
          className="inline-flex min-h-11 items-center gap-1.5 rounded-full bg-field px-4 text-sm font-semibold text-ink hover:brightness-95 focus-visible:outline-2 focus-visible:outline-focus md:hidden"
        >
          <FunnelIcon />
          {`Фильтры${phoneCount > 0 ? ` · ${phoneCount}` : ''}`}
        </button>
        {/* телефон: «Обновить» рядом с «Фильтрами» — остальные контролы в окне */}
        <span className="contents md:hidden">{refresh('size-11')}</span>
        <div className="contents max-md:hidden">
          <ChangedMark on={changed.period}>
            <PeriodMenu
              state={state}
              today={today}
              periods={REPORT_PERIODS}
              heading={config.dateHeading}
              validate={customRangeError}
              onChange={(next) => update(withFittingStep(next, today))}
            />
          </ChangedMark>
          <ChangedMark on={changed.by}>
            <ChoiceMenu name="Разрез" value={state.by} options={BY_CHOICES} onChange={(by) => update({ ...state, by })} />
          </ChangedMark>
          <ChangedMark on={changed.step}>
            <ChoiceMenu name="Шаг" value={step} options={stepChoices(range)} onChange={(s) => update({ ...state, step: s })} />
          </ChangedMark>
          <ChangedMark on={changed.filter}>
            <button
              type="button"
              aria-haspopup="dialog"
              onClick={() => setFilterOpen('desktop')}
              className="inline-flex items-center gap-1.5 rounded-full bg-field px-4 py-2 text-sm font-semibold text-ink hover:brightness-95 focus-visible:outline-2 focus-visible:outline-focus"
            >
              <FunnelIcon />
              {`Фильтр${changed.filter ? ` · ${reportFilterCount(state)}` : ''}`}
            </button>
          </ChangedMark>
          {/* проценты — только в таблице (§2.2) */}
          {table && (
            <ChangedMark on={changed.percent}>
              <ChoiceMenu
                name="Проценты"
                value={state.percent ? 'on' : 'off'}
                options={PERCENT_CHOICES}
                onChange={(v) => update({ ...state, percent: v === 'on' })}
              />
            </ChangedMark>
          )}
          {Object.values(changed).some(Boolean) && (
            <button
              type="button"
              onClick={() => {
                update(resetReportState(state));
                // кнопка исчезает вместе с фокусом — он переходит на заголовок отчёта
                headingRef.current?.focus();
              }}
              className="text-sm font-semibold text-muted underline hover:text-ink"
            >
              Сбросить
            </button>
          )}
          {/* справа панели: «Обновить» и «?» одним блоком — не переносятся порознь (R7) */}
          <div className="ml-auto flex shrink-0 items-center gap-2">
            {refresh('size-9')}
            {help}
          </div>
        </div>
      </div>
      <ReportFilterDialog
        open={filterOpen !== false}
        phone={filterOpen === 'phone'}
        today={today}
        dateHeading={config.dateHeading}
        state={state}
        data={{
          accounts: accounts.data!,
          categories: categories.data!,
          projects: projects.data!,
          counterparties: counterparties.data!,
          tags: tags.data,
        }}
        onApply={update}
        onClose={() => setFilterOpen(false)}
      />
      {notice && (
        <p role="status" className="mb-3 rounded-lg bg-field px-3 py-2 text-sm text-ink">
          {notice}
        </p>
      )}
      <StaleNotice queries={report.data ? [report] : []} />
      {!report.data && !report.error ? (
        // скелет (§10): серые полосы на месте строк
        <div aria-busy="true" className="flex flex-col gap-2">
          <span className="sr-only">Загрузка…</span>
          {[0, 1, 2, 3, 4, 5].map((i) => (
            <div key={i} className="h-10 animate-pulse rounded-lg bg-field" />
          ))}
        </div>
      ) : !report.data ? (
        <div className="py-8 text-center">
          <p role="alert" className="mb-4 text-expense-strong">
            {report.error?.message}
          </p>
          <button type="button" onClick={() => void report.refetch()} className={btnSecondary}>
            Повторить
          </button>
        </div>
      ) : table ? (
        <ReportTable
          caption={config.title}
          data={report.data}
          percent={state.percent}
          expanded={expanded}
          onToggle={(id) =>
            setExpanded((prev) => {
              const next = new Set(prev);
              if (next.has(id)) next.delete(id);
              else next.add(id);
              return next;
            })
          }
          busy={report.isPlaceholderData}
          active={cell}
          onCell={(row, column) => !report.isPlaceholderData && setCell({ row: row.id, col: column?.key ?? 'total', title: cellTitle(row, column), apiParams })}
        />
      ) : (
        <div aria-busy={report.isPlaceholderData} className={report.isPlaceholderData ? 'opacity-60' : ''}>
          <ReportCharts
            title={config.title}
            data={report.data}
            names={config.names}
            selected={chartCol}
            busy={report.isPlaceholderData}
            // пока показан прежний отчёт, колонки не выбираются (как ячейки таблицы, R8)
            onSelect={(col) => !report.isPlaceholderData && setPicked(col === null ? null : { col, apiParams })}
          />
        </div>
      )}
      {table && cell && report.data && (
        <ReportOperations
          company={company}
          title={cell.title}
          params={cellParams(cell)}
          lookups={lookups}
          timeZone={timeZone}
          today={today}
          mobile={mobile}
          onClose={closeCell}
        />
      )}
      {!table && report.data && !report.data.meta.empty && (
        // под графиками — операции периода или выбранной колонки в две колонки (§4.2, п. 4)
        <section aria-labelledby={periodOpsId} className="mt-10">
          <div className="mb-3 flex flex-wrap items-center gap-3">
            <h2 id={periodOpsId} ref={periodOpsRef} tabIndex={-1} className="text-xl font-bold outline-none">
              {periodTitle('Операции')}
            </h2>
            {chartCol !== null && (
              <button
                type="button"
                onClick={() => {
                  setPicked(null);
                  // кнопка исчезает — фокус на заголовок списка
                  periodOpsRef.current?.focus();
                }}
                className="text-sm font-semibold text-muted underline hover:text-ink"
              >
                Весь период
              </button>
            )}
          </div>
          {/* в две колонки — от 2xl (R8): на 1280–1536 px колонке тесно */}
          <div className="grid gap-8 2xl:grid-cols-2">
            {(['income', 'expense'] as const).map((group) => (
              <ReportOperations
                key={group}
                company={company}
                title={config.names[group]}
                params={cellParams({ row: group, col: chartCol ?? 'total' })}
                lookups={lookups}
                timeZone={timeZone}
                today={today}
                mobile={mobile}
                autoFocus={false}
                headingLevel={3}
                columns={CHART_COLUMNS}
                narrow
              />
            ))}
          </div>
        </section>
      )}
    </section>
  );
}
