import { useEffect, useRef, useState } from 'react';
import { Link, useOutletContext } from 'react-router';
import { projectsCellTitle, type ProjectsCol } from '../../../shared/report-projects';
import { CategoryFocus } from '../../components/analytics/CategoryFocus';
import { ChangedMark, ChoiceMenu } from '../../components/analytics/ChoiceMenu';
import { projectsCellKey, ProjectsTable } from '../../components/analytics/ProjectsTable';
import { ReportFilterDialog } from '../../components/analytics/ReportFilterDialog';
import { ReportOperations } from '../../components/analytics/ReportOperations';
import { ExcelLink, RefreshButton, ReportHeader, ReportLoading } from '../../components/analytics/ReportParts';
import { HelpButton } from '../../components/HelpButton';
import { FunnelIcon } from '../../components/icons';
import { PeriodMenu } from '../../components/journal/PeriodMenu';
import { Pending, StaleNotice } from '../../components/QueryState';
import { useProjectsReport } from '../../lib/analytics';
import { periodLabel } from '../../lib/journal-filter';
import { useIsMobile } from '../../lib/media';
import type { Company } from '../../lib/queries';
import { focusLabel, rowCategoryId, toggleFocus, type CategoryFocusProps } from '../../lib/report-focus';
import { useReportSettings } from '../../lib/report-settings';
import { noBatchText, projectsListMissesStock, STOCK_LIST_NOTE } from '../../lib/report-table';
import {
  changedControls,
  customRangeError,
  MODE_CHOICES,
  phoneReportCount,
  projectsApiParams,
  projectsExcelHref,
  projectsState,
  REPORT_PERIODS,
  reportFilterCount,
  reportRange,
  resetReportState,
  STATUS_CHOICES,
  STOCK_CHOICES,
} from '../../lib/report-url';
import type { CompanyOutletContext } from '../CompanyLayout';

const TITLE = 'Проекты';
const HELP =
  'Доходы, расходы, прибыль и рентабельность каждого проекта (клуба) за период. Отчёт строится по тем же правилам, что «Прибыль»: по дате сделки, без переводов, инвестиций, дивидендов, займов и кредитов, товары склада — по себестоимости. Операции без проекта — в строке «Без проекта». Проекты другого статуса с суммами за период показаны одной строкой «… (вместе)», поэтому «Всего» равно «Прибыли».';

/**
 * «Проекты» (§7 спецификации «Аналитика»): статус и режим, период по дате сделки, склад, «Фильтр» без проектов, «Excel»,
 * «Обновить». Таблица — ProjectsTable; щелчок по строке или ячейке открывает её операции под таблицей (§2.5). Настройки —
 * в адресе; на телефоне контролы — в окне «Фильтры», как у остальных отчётов.
 */
function ProjectsScreen({ company }: { company: Company }) {
  const settings = useReportSettings(company, { stock: true, normalize: projectsState });
  const { state, today, timeZone, stockAvailable, notice, update, lookups } = settings;
  const apiParams = today && settings.ready ? projectsApiParams(state, today).toString() : null;
  const report = useProjectsReport(company.id, apiParams);
  const mobile = useIsMobile();
  const headingRef = useRef<HTMLHeadingElement>(null);
  const [filterOpen, setFilterOpen] = useState<false | 'phone' | 'desktop'>(false);
  // ячейка, по которой открыт список операций; заголовок и настройки отчёта запоминаются при щелчке
  const [opened, setCell] = useState<{ row: string; col: ProjectsCol; title: string; apiParams: string | null } | null>(null);
  const cell = opened && opened.apiParams === apiParams ? opened : null;
  useEffect(() => setCell(null), [apiParams]);
  // итог для программ чтения: объявляется, когда пришёл новый ответ
  const [announcement, setAnnouncement] = useState('');
  const freshStamp = report.data && !report.isPlaceholderData ? report.dataUpdatedAt : 0;
  const freshPeriod = periodLabel(state);
  useEffect(() => {
    if (!freshStamp) return;
    setAnnouncement('');
    const timer = setTimeout(() => setAnnouncement(`Отчёт обновлён: ${freshPeriod}`), 100);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [freshStamp]);

  const help = <HelpButton about={TITLE} text={HELP} />;
  const header = <ReportHeader companyId={company.id} title={TITLE} subtitle="Прибыль и рентабельность по каждому клубу" headingRef={headingRef} help={help} />;
  const status = (
    <p role="status" aria-live="polite" className="sr-only">
      {announcement}
    </p>
  );
  const filterData = settings.filterData;
  if (!today || !timeZone || !lookups || !filterData) {
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
  const range = reportRange(state, today);
  const changed = changedControls(state, range);
  const phoneCount = phoneReportCount(state, range);
  // выбор одной категории нажатием (спецификация 2026-10-19, часть 3): категория из справочника; на прежнем отчёте кнопки aria-disabled
  const focus: CategoryFocusProps = {
    selected: state.focusCategoryId,
    canSelect: (rowId) => {
      const id = rowCategoryId(rowId);
      return state.mode === 'categories' && id !== null && lookups.categories.has(id);
    },
    onSelect: (id) => update(toggleFocus(state, id), { push: true }),
  };
  const focusChip = state.focusCategoryId !== null && (
    <CategoryFocus label={focusLabel(filterData.categories, state.focusCategoryId) ?? '…'} onClear={() => update({ ...state, focusCategoryId: null }, { push: true })} />
  );

  const refresh = (size: string) => <RefreshButton size={size} spinning={report.isFetching} onClick={() => void report.refetch()} />;
  const excel = (size: string) => <ExcelLink size={size} href={projectsExcelHref(company.id, state, today)} />;
  const closeCell = () => {
    const key = cell && projectsCellKey(cell.row, cell.col);
    setCell(null);
    // фокус — в ячейку, из которой открыли список (если она ещё в таблице), иначе на заголовок отчёта
    requestAnimationFrame(() => (document.querySelector<HTMLElement>(`[data-cell="${CSS.escape(key ?? '')}"]`) ?? headingRef.current)?.focus());
  };
  const cellParams = (c: { row: string; col: ProjectsCol }) => {
    const p = new URLSearchParams(apiParams ?? '');
    p.set('report', 'projects');
    p.set('row', c.row);
    p.set('col', c.col);
    return p.toString();
  };

  return (
    <section>
      {header}
      {status}
      {/* панель прилипает к верху (§2.2); на телефоне сверху «Фильтры», «Excel» и «Обновить», остальное — в окне */}
      <div className="sticky top-0 z-20 -mx-4 mb-4 flex flex-wrap items-center gap-2 bg-card px-4 py-2 md:-mx-8 md:gap-1.5 md:px-8">
        <button
          type="button"
          aria-haspopup="dialog"
          onClick={() => setFilterOpen('phone')}
          className="inline-flex min-h-11 items-center gap-1.5 rounded-full bg-field px-4 text-sm font-semibold text-ink hover:brightness-95 focus-visible:outline-2 focus-visible:outline-focus md:hidden"
        >
          <FunnelIcon />
          {`Фильтры${phoneCount > 0 ? ` · ${phoneCount}` : ''}`}
        </button>
        <span className="contents md:hidden">
          {excel('size-11')}
          {refresh('size-11')}
        </span>
        <div className="contents max-md:hidden">
          <ChangedMark on={changed.status}>
            <ChoiceMenu name="Проекты" value={state.status} options={STATUS_CHOICES} onChange={(s) => update({ ...state, status: s })} />
          </ChangedMark>
          <ChangedMark on={changed.mode}>
            <ChoiceMenu name="Режим" value={state.mode} options={MODE_CHOICES} onChange={(mode) => update({ ...state, mode })} />
          </ChangedMark>
          <ChangedMark on={changed.period}>
            <PeriodMenu state={state} today={today} periods={REPORT_PERIODS} heading="По дате сделки" validate={customRangeError} onChange={update} />
          </ChangedMark>
          {stockAvailable && (
            <ChangedMark on={changed.stock}>
              <ChoiceMenu name="Склад" value={state.stock ? 'on' : 'off'} options={STOCK_CHOICES} onChange={(v) => update({ ...state, stock: v === 'on' })} />
            </ChangedMark>
          )}
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
        dateHeading="По дате сделки"
        stock={stockAvailable}
        projects
        state={state}
        data={filterData}
        onApply={update}
        onClose={() => setFilterOpen(false)}
      />
      {notice && (
        <p role="status" className="mb-3 rounded-lg bg-field px-3 py-2 text-sm text-ink">
          {notice}
        </p>
      )}
      {focusChip}
      <StaleNotice queries={report.data ? [report] : []} />
      {!report.data ? (
        <ReportLoading error={report.error} onRetry={() => void report.refetch()} />
      ) : (
        <ProjectsTable
          focus={focus}
          data={report.data}
          busy={report.isPlaceholderData}
          active={cell}
          onCell={(row, parent, col) => !report.isPlaceholderData && setCell({ row: row.id, col, title: projectsCellTitle(row, parent, col), apiParams })}
        />
      )}
      {report.data && report.data.meta.noBatch > 0 && !report.isPlaceholderData && (
        // продажи «Нет партии» (§5.3): себестоимость не определена — ссылка туда, где это исправить
        <p className="mt-4 rounded-lg bg-expense-soft px-3 py-2 text-sm text-ink">
          {noBatchText(report.data.meta.noBatch)}.{' '}
          <Link to={`/c/${company.id}/stock/balance`} className="font-semibold underline">
            Склад → Остатки
          </Link>
        </p>
      )}
      {cell && report.data && (
        <ReportOperations
          company={company}
          title={cell.title}
          params={cellParams(cell)}
          lookups={lookups}
          timeZone={timeZone}
          today={today}
          mobile={mobile}
          dealDates
          footnote={projectsListMissesStock(report.data.meta.stock, cell.row, cell.col) ? STOCK_LIST_NOTE : undefined}
          onClose={closeCell}
        />
      )}
    </section>
  );
}

/** Маршрут не пересоздаёт страницу при смене компании — экран с key. */
export function ProjectsPage() {
  const { company } = useOutletContext<CompanyOutletContext>();
  return <ProjectsScreen key={company.id} company={company} />;
}
