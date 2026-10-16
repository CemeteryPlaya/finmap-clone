import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useOutletContext, useSearchParams } from 'react-router';
import { todayInTimezone } from '../../../shared/dates';
import { ChangedMark, ChoiceMenu } from '../../components/analytics/ChoiceMenu';
import { ReportTable } from '../../components/analytics/ReportTable';
import { HelpButton } from '../../components/HelpButton';
import { RefreshIcon } from '../../components/icons';
import { PeriodMenu } from '../../components/journal/PeriodMenu';
import { Pending, StaleNotice } from '../../components/QueryState';
import { btnSecondary } from '../../components/ui';
import { useCashflow } from '../../lib/analytics';
import { periodLabel } from '../../lib/journal-filter';
import { useMeta } from '../../lib/query';
import type { Company } from '../../lib/queries';
import { DEFAULT_EXPANDED } from '../../lib/report-table';
import {
  BY_LABELS,
  changedControls,
  customRangeError,
  DEFAULT_REPORT_STATE,
  effectiveStep,
  isReportChanged,
  parseReportSearch,
  REPORT_PERIODS,
  reportApiParams,
  reportRange,
  reportSearch,
  STEP_LABELS,
  stepChoices,
  withFittingStep,
  type ReportUrlState,
} from '../../lib/report-url';
import type { CompanyOutletContext } from '../CompanyLayout';

const BY_CHOICES = (['category', 'counterparty', 'project'] as const).map((value) => ({ value, label: BY_LABELS[value] }));
const PERCENT_CHOICES = [
  { value: 'off', label: 'Скрыть проценты' },
  { value: 'on', label: 'Показать проценты' },
] as const;

const HELP = 'Отчёт «Деньги» формируется по дате платежа: он показывает движение денег независимо от даты сделки, по всем категориям.';

/** «Деньги / Cash flow» (§4 спецификации «Аналитика»). Маршрут не пересоздаёт страницу при смене компании — экран с key. */
export function CashflowPage() {
  const { company } = useOutletContext<CompanyOutletContext>();
  return <CashflowScreen key={company.id} company={company} />;
}

function CashflowScreen({ company }: { company: Company }) {
  const meta = useMeta();
  const [params, setParams] = useSearchParams();
  const state = useMemo(() => parseReportSearch(params), [params]);
  const timeZone = meta.data?.timezone;
  const today = timeZone ? todayInTimezone(timeZone) : null;
  const apiParams = today ? reportApiParams(state, today).toString() : null;
  const report = useCashflow(company.id, apiParams);
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(() => new Set(DEFAULT_EXPANDED));
  const headingRef = useRef<HTMLHeadingElement>(null);
  // итог для программ чтения: объявляется, когда пришёл новый ответ (не прежняя таблица, оставленная до ответа)
  const [announcement, setAnnouncement] = useState('');
  const fresh = report.data && !report.isPlaceholderData ? report.data : null;
  const freshStamp = fresh ? report.dataUpdatedAt : 0;
  const freshStep = fresh?.meta.step;
  const freshPeriod = periodLabel(state);
  useEffect(() => {
    if (freshStamp && freshStep) setAnnouncement(`Отчёт обновлён: ${freshPeriod}, ${STEP_LABELS[freshStep].toLowerCase()}`);
    // период в подписи — тот, для которого пришёл ответ: смена настроек без ответа ничего не объявляет
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [freshStamp]);

  // настройки меняют адрес без новой записи в истории: «Назад» уводит со страницы, а не по шагам настроек
  const update = (next: ReportUrlState) => setParams(reportSearch(next), { replace: true });
  const changed = changedControls(state);
  const range = today ? reportRange(state, today) : null;

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
            Деньги
          </h1>
          <HelpButton about="Деньги" text={HELP} />
        </div>
        <p className="text-sm text-muted">Отчёт о движении денежных средств (cash flow)</p>
      </div>
    </div>
  );

  if (!today || !range) {
    return (
      <section>
        {header}
        <Pending queries={[meta]} />
      </section>
    );
  }

  const step = effectiveStep(state.step, range);
  return (
    <section>
      {header}
      {/* область есть всегда, пока пустая: первое объявление тоже читается (как «итог выделения» журнала) */}
      <p role="status" aria-live="polite" className="sr-only">
        {announcement}
      </p>
      {/* панель контролов прилипает к верху при прокрутке (§2.2) */}
      <div className="sticky top-0 z-20 -mx-4 mb-4 flex flex-wrap items-center gap-2 bg-card px-4 py-2 md:-mx-8 md:px-8">
        <ChangedMark on={changed.period}>
          <PeriodMenu
            state={state}
            today={today}
            periods={REPORT_PERIODS}
            heading="По дате платежа"
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
        <ChangedMark on={changed.percent}>
          <ChoiceMenu name="Проценты" value={state.percent ? 'on' : 'off'} options={PERCENT_CHOICES} onChange={(v) => update({ ...state, percent: v === 'on' })} />
        </ChangedMark>
        <button
          type="button"
          aria-label="Обновить"
          title="Обновить"
          onClick={() => void report.refetch()}
          className="grid size-9 place-items-center rounded-full bg-field text-ink hover:brightness-95 focus-visible:outline-2 focus-visible:outline-focus"
        >
          <RefreshIcon spinning={report.isFetching} />
        </button>
        {isReportChanged(state) && (
          <button
            type="button"
            onClick={() => {
              update(DEFAULT_REPORT_STATE);
              // кнопка исчезает вместе с фокусом — он переходит на заголовок отчёта
              headingRef.current?.focus();
            }}
            className="text-sm font-semibold text-muted underline hover:text-ink"
          >
            Сбросить
          </button>
        )}
      </div>
      <StaleNotice queries={report.data ? [report] : []} />
      {!report.data && !report.error ? (
        // скелет таблицы (§10): серые полосы на месте строк
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
      ) : (
        <ReportTable
          caption="Деньги"
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
        />
      )}
    </section>
  );
}
