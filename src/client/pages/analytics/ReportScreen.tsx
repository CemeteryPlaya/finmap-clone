import { useEffect, useId, useRef, useState } from 'react';
import { Link } from 'react-router';
import { ChangedMark, ChoiceMenu } from '../../components/analytics/ChoiceMenu';
import { CategoryFocus } from '../../components/analytics/CategoryFocus';
import { ReportCharts } from '../../components/analytics/ReportCharts';
import { ReportFilterDialog } from '../../components/analytics/ReportFilterDialog';
import { DEAL_ORDER_NOTE, ReportOperations } from '../../components/analytics/ReportOperations';
import { ExcelLink, RefreshButton, ReportHeader, ReportLoading } from '../../components/analytics/ReportParts';
import { cellKey, ReportTable } from '../../components/analytics/ReportTable';
import { ViewSwitch } from '../../components/analytics/ViewSwitch';
import type { BarsLineNames } from '../../components/charts/BarsLineChart';
import { HelpButton } from '../../components/HelpButton';
import { FunnelIcon } from '../../components/icons';
import { PeriodMenu } from '../../components/journal/PeriodMenu';
import { Pending, StaleNotice } from '../../components/QueryState';
import { btnClose } from '../../components/ui';
import { useReport, type ReportKind } from '../../lib/analytics';
import type { JournalColumnId } from '../../lib/journal-columns';
import { periodLabel } from '../../lib/journal-filter';
import { useIsMobile } from '../../lib/media';
import { PNL_BANNER_PREF, pnlBannerHidden } from '../../lib/preferences';
import { savePreference, usePreferences, type Company } from '../../lib/queries';
import { focusLabel, rowCategoryId, toggleFocus, type CategoryFocusProps } from '../../lib/report-focus';
import { useReportSettings } from '../../lib/report-settings';
import { cellTitle, DEFAULT_EXPANDED, listMissesStock, noBatchText, STOCK_LIST_NOTE } from '../../lib/report-table';
import {
  BY_CHOICES,
  changedControls,
  columnsReportState,
  customRangeError,
  effectiveStep,
  PERCENT_CHOICES,
  phoneReportCount,
  REPORT_PERIODS,
  reportApiParams,
  reportExcelHref,
  reportFilterCount,
  reportRange,
  resetReportState,
  STEP_LABELS,
  stepChoices,
  STOCK_CHOICES,
  withFittingStep,
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
  /** Переключатель «Учитывать склад по себестоимости» (§5.3): показывается, если у компании есть склад. */
  stock?: boolean;
  /** Списки операций с «Датой сделки» и «Движением денег» (§5.2). */
  dealDates?: boolean;
  /** Закрываемый баннер над отчётом (§5.1); закрытие запоминается настройкой пользователя. */
  banner?: { title: string; text: string; note: string };
}

/** Колонки списков под графиками (§4.2): две колонки рядом — без счёта и проекта; у «Прибыли» «Движение денег» — вторая строка под «Датой сделки» (R8). */
const CHART_COLUMNS: readonly JournalColumnId[] = ['date', 'amount', 'counterparty', 'category', 'comment'];

/**
 * Страница отчёта (§2.2 спецификации «Аналитика»): заголовок с видом «график / таблица», панель контролов (период, разрез,
 * шаг, «Фильтр», проценты в таблице, «Сбросить», справа «Обновить» и «?»), вид «график» (§4.2) или «таблица» (§4.1) и
 * операции под ними (§2.5). Настройки — в адресе. Экран создаётся заново при смене компании (key у страницы).
 */
export function ReportScreen({ company, config }: { company: Company; config: ReportConfig }) {
  // склад (§5.3): переключатель — только у отчёта со складом и компании со складом; без него stock=0 из адреса не действует
  const settings = useReportSettings(company, { stock: !!config.stock, normalize: columnsReportState });
  const { state, today, timeZone, stockAvailable, notice, update, lookups } = settings;
  const prefs = usePreferences();
  // с id в адресе отчёт запрашивается, когда справочники загружены и id проверены; у «Прибыли» — ещё и склады
  const apiParams = today && settings.ready ? reportApiParams(state, today).toString() : null;
  const report = useReport(company.id, config.report, apiParams);
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(() => new Set(DEFAULT_EXPANDED));
  const headingRef = useRef<HTMLHeadingElement>(null);
  const bannerId = useId();
  const [bannerClosed, setBannerClosed] = useState(false);
  // баннер виден, пока пользователь его не закрыл (настройка); до ответа настроек — не мигает
  const bannerShown = !!config.banner && !bannerClosed && (prefs.data ? !pnlBannerHidden(prefs.data) : prefs.isError);
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

  const refresh = (size: string) => <RefreshButton size={size} spinning={report.isFetching} onClick={() => void report.refetch()} />;

  // «Excel» (§2.6): файл — текущая таблица отчёта; на компьютере только значок (R10: в худшем случае панели на 1440 px всё в одну строку)
  const excel = (size: string) => today && <ExcelLink size={size} href={reportExcelHref(company.id, config.report, state, today)} />;

  const help = <HelpButton about={config.title} text={config.help} />;

  // компьютер: вид рядом с заголовком, как у Finmap (R7); «?» там уходит вправо панели, на телефоне остаётся у заголовка
  const header = (
    <ReportHeader
      companyId={company.id}
      title={config.title}
      subtitle={config.subtitle}
      headingRef={headingRef}
      help={help}
      aside={<ViewSwitch value={state.view} onChange={(view) => update({ ...state, view })} />}
    />
  );

  const filterData = settings.filterData;
  if (!today || !range || !timeZone || !lookups || !filterData) {
    return (
      <section>
        {header}
        {status}
        {/* «?» компьютера живёт в панели; пока панели нет — под заголовком */}
        <div className="mb-2 flex justify-end max-md:hidden">{help}</div>
        <Pending queries={settings.dictionaries} />
      </section>
    );
  }
  // выбор одной категории нажатием (спецификация 2026-10-19, часть 3): категория из справочника; на прежнем отчёте кнопки aria-disabled
  const focus: CategoryFocusProps = {
    selected: state.focusCategoryId,
    canSelect: (rowId) => {
      const id = rowCategoryId(rowId);
      return state.by === 'category' && id !== null && lookups.categories.has(id);
    },
    onSelect: (id) => update(toggleFocus(state, id), { push: true }),
  };
  const focusChip = state.focusCategoryId !== null && (
    <CategoryFocus label={focusLabel(filterData.categories, state.focusCategoryId) ?? '…'} onClear={() => update({ ...state, focusCategoryId: null }, { push: true })} />
  );
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
      <div className="sticky top-0 z-20 -mx-4 mb-4 flex flex-wrap items-center gap-2 bg-card md:gap-1.5 px-4 py-2 md:-mx-8 md:px-8">
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
        <span className="contents md:hidden">
          {excel('size-11')}
          {refresh('size-11')}
        </span>
        <div className="contents max-md:hidden md:[&_button.bg-field:not(.size-8)]:px-3">
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
          {stockAvailable && (
            <ChangedMark on={changed.stock}>
              <ChoiceMenu name="Склад" value={state.stock ? 'on' : 'off'} options={STOCK_CHOICES} onChange={(v) => update({ ...state, stock: v === 'on' })} />
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
          {/* справа панели: «Excel», «Обновить» и «?» одним блоком — не переносятся порознь (R7) */}
          <div className="ml-auto flex shrink-0 items-center gap-1">
            {excel('size-8')}
            {refresh('size-8')}
            {help}
          </div>
        </div>
      </div>
      <ReportFilterDialog
        open={filterOpen !== false}
        phone={filterOpen === 'phone'}
        today={today}
        dateHeading={config.dateHeading}
        stock={stockAvailable}
        state={state}
        data={filterData}
        onApply={update}
        onClose={() => setFilterOpen(false)}
      />
      {bannerShown && config.banner && (
        <section aria-labelledby={bannerId} className="mb-4 flex items-start gap-3 rounded-2xl bg-income-soft/60 p-4 ring-1 ring-income/30">
          <div className="min-w-0 flex-1">
            <h2 id={bannerId} className="text-sm font-bold text-ink">
              {config.banner.title}
            </h2>
            <p className="mt-1 text-sm text-ink">{config.banner.text}</p>
            <p className="mt-1 text-xs text-label">{config.banner.note}</p>
          </div>
          <button
            type="button"
            aria-label="Скрыть подсказку"
            title="Скрыть"
            onClick={() => {
              setBannerClosed(true);
              // кнопка исчезает вместе с фокусом — он переходит на заголовок отчёта; закрытие запоминается
              headingRef.current?.focus();
              void savePreference(PNL_BANNER_PREF, true).catch(() => undefined);
            }}
            className={btnClose}
          >
            <span aria-hidden="true">×</span>
          </button>
        </section>
      )}
      {notice && (
        <p role="status" className="mb-3 rounded-lg bg-field px-3 py-2 text-sm text-ink">
          {notice}
        </p>
      )}
      {focusChip}
      <StaleNotice queries={report.data ? [report] : []} />
      {!report.data ? (
        <ReportLoading error={report.error} onRetry={() => void report.refetch()} />
      ) : table ? (
        <ReportTable
          focus={focus}
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
            focus={focus}
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
      {(report.data?.meta.noBatch ?? 0) > 0 && !report.isPlaceholderData && (
        // продажи «Нет партии» (§5.3): себестоимость не определена — ссылка туда, где это исправить
        <p className="mt-4 rounded-lg bg-expense-soft px-3 py-2 text-sm text-ink">
          {noBatchText(report.data!.meta.noBatch!)}.{' '}
          <Link to={`/c/${company.id}/stock/balance`} className="font-semibold underline">
            Склад → Остатки
          </Link>
        </p>
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
          dealDates={config.dealDates}
          footnote={listMissesStock(config.report, report.data.meta.stock, cell.row) ? STOCK_LIST_NOTE : undefined}
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
          {config.dealDates && <p className="-mt-1 mb-3 text-sm text-muted">{DEAL_ORDER_NOTE}</p>}
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
                dealDates={config.dealDates}
                narrow
              />
            ))}
          </div>
          {listMissesStock(config.report, report.data.meta.stock, 'expense') && <p className="mt-4 text-sm text-muted">{STOCK_LIST_NOTE}</p>}
        </section>
      )}
    </section>
  );
}
