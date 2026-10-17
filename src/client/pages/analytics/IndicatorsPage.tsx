import { useEffect, useRef, useState } from 'react';
import { Link, useOutletContext } from 'react-router';
import { INDICATORS, type IndicatorKey } from '../../../shared/report-indicators';
import { ChangedMark, ChoiceMenu } from '../../components/analytics/ChoiceMenu';
import { IndicatorDialog } from '../../components/analytics/IndicatorDialog';
import { IndicatorsHistory } from '../../components/analytics/IndicatorsHistory';
import { INDICATOR_DOT, indicatorCellKey, IndicatorsTable } from '../../components/analytics/IndicatorsTable';
import { ReportOperations } from '../../components/analytics/ReportOperations';
import { ExcelLink, RefreshButton, ReportHeader, ReportLoading } from '../../components/analytics/ReportParts';
import { HelpButton } from '../../components/HelpButton';
import { PeriodMenu } from '../../components/journal/PeriodMenu';
import { Pending, StaleNotice } from '../../components/QueryState';
import { INDICATOR_STEP_CHOICES, indicatorsApiParams, indicatorsExcelHref, indicatorsState, useIndicators } from '../../lib/indicators';
import { useIsMobile } from '../../lib/media';
import { useCategories, type Company } from '../../lib/queries';
import { useReportSettings } from '../../lib/report-settings';
import { cellTitle, noBatchText, STOCK_LIST_NOTE } from '../../lib/report-table';
import { changedControls, customRangeError, REPORT_PERIODS, reportRange, resetReportState } from '../../lib/report-url';
import type { CompanyOutletContext } from '../CompanyLayout';

const TITLE = 'Финансовые показатели';
const HELP =
  'Валовая прибыль, маржинальный доход, EBITDA и процент маржи по месяцам или кварталам. Показатели считаются по тем же правилам, что «Прибыль»: по дате сделки, без переводов, инвестиций, дивидендов, займов и кредитов. Нажмите название показателя, чтобы выбрать категории, из которых он складывается; флажок «Себестоимость склада (FIFO)» добавляет себестоимость проданных и списанных товаров склада.';

type Tab = 'table' | 'history';

/**
 * «Финансовые показатели» (§8 спецификации «Аналитика»): вкладки «Финансовые показатели» и «История», период по дате
 * сделки, шаг (месяцы или кварталы), «Excel», «Обновить». Таблица — IndicatorsTable; щелчок по названию открывает окно
 * «Редактировать показатель», по значению — операции показателя за колонку (§2.5). Под таблицей — подсказка и карточки
 * с формулами. На телефоне контролы те же, переносятся строками.
 */
function IndicatorsScreen({ company }: { company: Company }) {
  const settings = useReportSettings(company, { stock: false, normalize: indicatorsState });
  const { state, today, timeZone, update, lookups } = settings;
  const apiParams = today && settings.ready ? indicatorsApiParams(state, today).toString() : null;
  const report = useIndicators(company.id, apiParams);
  const categories = useCategories(company.id);
  const mobile = useIsMobile();
  const headingRef = useRef<HTMLHeadingElement>(null);
  const [tab, setTab] = useState<Tab>('table');
  const [editing, setEditing] = useState<IndicatorKey | null>(null);
  const [opened, setCell] = useState<{ row: string; col: string; title: string; apiParams: string | null } | null>(null);
  const cell = opened && opened.apiParams === apiParams ? opened : null;
  useEffect(() => setCell(null), [apiParams]);

  const help = <HelpButton about={TITLE} text={HELP} />;
  const header = <ReportHeader companyId={company.id} title={TITLE} subtitle="Валовая прибыль, маржинальный доход, EBITDA, процент маржи" headingRef={headingRef} help={help} />;
  if (!today || !timeZone || !lookups) {
    return (
      <section>
        {header}
        <Pending queries={settings.dictionaries} />
      </section>
    );
  }
  const changed = changedControls(state, reportRange(state, today));
  const size = mobile ? 'size-11' : 'size-8';
  const closeCell = () => {
    const key = cell && indicatorCellKey(cell.row, cell.col);
    setCell(null);
    requestAnimationFrame(() => (document.querySelector<HTMLElement>(`[data-cell="${CSS.escape(key ?? '')}"]`) ?? headingRef.current)?.focus());
  };
  const cellParams = (c: { row: string; col: string }) => {
    const p = new URLSearchParams(apiParams ?? '');
    p.set('report', 'indicators');
    p.set('row', c.row);
    p.set('col', c.col);
    return p.toString();
  };
  const tabButton = (value: Tab, label: string) => (
    <button
      type="button"
      aria-pressed={tab === value}
      onClick={() => setTab(value)}
      className={`min-h-9 rounded-full px-4 text-sm font-semibold focus-visible:outline-2 focus-visible:outline-focus max-md:min-h-11 ${tab === value ? 'bg-ink text-card' : 'text-ink hover:bg-field'}`}
    >
      {label}
    </button>
  );
  const data = report.data;
  const expensePart = (row: string) => INDICATORS.find((i) => i.key === row)?.parts[1];
  const missesStock = (row: string) => {
    const part = expensePart(row);
    return !!data && data.meta.stock && (part ? data.parts[part].includeStock : true);
  };

  return (
    <section>
      {header}
      {/* панель прилипает к верху (§2.2); на телефоне контролы переносятся строками */}
      <div className="sticky top-0 z-20 -mx-4 mb-4 flex flex-wrap items-center gap-2 bg-card px-4 py-2 md:-mx-8 md:gap-1.5 md:px-8">
        <ChangedMark on={changed.period}>
          <PeriodMenu state={state} today={today} periods={REPORT_PERIODS} heading="По дате сделки" validate={customRangeError} onChange={update} />
        </ChangedMark>
        <ChangedMark on={changed.step}>
          <ChoiceMenu name="Шаг" value={state.step === 'quarter' ? 'quarter' : 'month'} options={INDICATOR_STEP_CHOICES} onChange={(step) => update({ ...state, step })} />
        </ChangedMark>
        <div role="group" aria-label="Вкладки отчёта" className="inline-flex rounded-full bg-field p-1">
          {tabButton('table', 'Финансовые показатели')}
          {tabButton('history', 'История')}
        </div>
        {(changed.period || changed.step) && (
          <button
            type="button"
            onClick={() => {
              update(resetReportState(state));
              headingRef.current?.focus();
            }}
            className="text-sm font-semibold text-muted underline hover:text-ink"
          >
            Сбросить
          </button>
        )}
        <div className="ml-auto flex shrink-0 items-center gap-1">
          <ExcelLink size={size} href={indicatorsExcelHref(company.id, state, today)} />
          <RefreshButton size={size} spinning={report.isFetching} onClick={() => void report.refetch()} />
          <span className="max-md:hidden">{help}</span>
        </div>
      </div>
      {tab === 'history' ? (
        <IndicatorsHistory companyId={company.id} timeZone={timeZone} />
      ) : (
        <>
          <StaleNotice queries={data ? [report] : []} />
          {!data ? (
            <ReportLoading error={report.error} onRetry={() => void report.refetch()} />
          ) : (
            <>
              <IndicatorsTable
                data={data}
                busy={report.isPlaceholderData}
                active={cell}
                editable={!company.archivedAt && !!categories.data}
                onEdit={(row) => setEditing(row.id)}
                onCell={(row, column) => !report.isPlaceholderData && setCell({ row: row.id, col: column?.key ?? 'total', title: cellTitle({ id: row.id, kind: 'info', label: row.label, values: [], total: null }, column), apiParams })}
              />
              <p className="mt-3 text-xs text-muted">
                {company.archivedAt
                  ? 'Компания в архиве — категории показателей не меняются. Нажмите значение, чтобы увидеть операции.'
                  : 'Нажмите название показателя, чтобы выбрать категории. Нажмите значение, чтобы увидеть операции.'}
              </p>
              {data.meta.noBatch > 0 && !report.isPlaceholderData && (
                <p className="mt-3 rounded-lg bg-expense-soft px-3 py-2 text-sm text-ink">
                  {noBatchText(data.meta.noBatch)}.{' '}
                  <Link to={`/c/${company.id}/stock/balance`} className="font-semibold underline">
                    Склад → Остатки
                  </Link>
                </p>
              )}
              {cell && (
                <ReportOperations
                  company={company}
                  title={cell.title}
                  params={cellParams(cell)}
                  lookups={lookups}
                  timeZone={timeZone}
                  today={today}
                  mobile={mobile}
                  dealDates
                  footnote={missesStock(cell.row) ? STOCK_LIST_NOTE : undefined}
                  onClose={closeCell}
                />
              )}
              <ul aria-label="Формулы показателей" className="mt-6 grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-4">
                {INDICATORS.map((i) => (
                  <li key={i.key} className="rounded-xl border border-field p-4">
                    <p className="flex items-center gap-2 font-semibold">
                      <span aria-hidden="true" className={`size-2 rounded-full ${INDICATOR_DOT[i.key]}`} />
                      {i.label}
                    </p>
                    <p className="mt-2 text-sm">{i.formula}</p>
                  </li>
                ))}
              </ul>
              {categories.data && (
                <IndicatorDialog companyId={company.id} indicator={editing} parts={data.parts} categories={categories.data} onClose={() => setEditing(null)} />
              )}
            </>
          )}
        </>
      )}
    </section>
  );
}

/** Маршрут не пересоздаёт страницу при смене компании — экран с key. */
export function IndicatorsPage() {
  const { company } = useOutletContext<CompanyOutletContext>();
  return <IndicatorsScreen key={company.id} company={company} />;
}
