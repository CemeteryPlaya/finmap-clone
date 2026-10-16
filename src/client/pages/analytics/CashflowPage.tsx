import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useOutletContext, useSearchParams } from "react-router";
import { todayInTimezone } from "../../../shared/dates";
import { ChangedMark, ChoiceMenu } from "../../components/analytics/ChoiceMenu";
import { ReportFilterDialog } from "../../components/analytics/ReportFilterDialog";
import { ReportOperations } from "../../components/analytics/ReportOperations";
import { cellKey, ReportTable } from "../../components/analytics/ReportTable";
import { HelpButton } from "../../components/HelpButton";
import { FunnelIcon, RefreshIcon } from "../../components/icons";
import type { JournalLookups } from "../../components/journal/JournalTable";
import { PeriodMenu } from "../../components/journal/PeriodMenu";
import { Pending, StaleNotice } from "../../components/QueryState";
import { btnSecondary } from "../../components/ui";
import { useCashflow } from "../../lib/analytics";
import { periodLabel } from "../../lib/journal-filter";
import { categoryLookup } from "../../lib/journal-format";
import { useIsMobile } from "../../lib/media";
import { useMeta } from "../../lib/query";
import {
  useAccounts,
  useCategories,
  useCounterparties,
  useProjects,
  useTags,
  type Company,
} from "../../lib/queries";
import { cellTitle, DEFAULT_EXPANDED } from "../../lib/report-table";
import {
  BY_CHOICES,
  changedControls,
  customRangeError,
  DEFAULT_REPORT_STATE,
  effectiveStep,
  parseReportSearch,
  PERCENT_CHOICES,
  phoneReportCount,
  REPORT_PERIODS,
  reportApiParams,
  reportFilterCount,
  reportRange,
  reportSearch,
  STEP_LABELS,
  stepChoices,
  withFittingStep,
  type ReportUrlState,
} from "../../lib/report-url";
import type { CompanyOutletContext } from "../CompanyLayout";

const HELP =
  "Отчёт «Деньги» формируется по дате платежа: он показывает движение денег независимо от даты сделки, по всем категориям.";

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
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(
    () => new Set(DEFAULT_EXPANDED),
  );
  const headingRef = useRef<HTMLHeadingElement>(null);
  // итог для программ чтения: объявляется, когда пришёл новый ответ (не прежняя таблица, оставленная до ответа)
  const [announcement, setAnnouncement] = useState("");
  const fresh = report.data && !report.isPlaceholderData ? report.data : null;
  const freshStamp = fresh ? report.dataUpdatedAt : 0;
  const freshStep = fresh?.meta.step;
  const freshPeriod = periodLabel(state);
  useEffect(() => {
    if (!freshStamp || !freshStep) return;
    // сначала пусто, на следующем кадре — текст: тот же текст (смена разреза, «Обновить») тоже объявляется
    setAnnouncement("");
    const frame = requestAnimationFrame(() =>
      setAnnouncement(
        `Отчёт обновлён: ${freshPeriod}, ${STEP_LABELS[freshStep].toLowerCase()}`,
      ),
    );
    return () => cancelAnimationFrame(frame);
    // период в подписи — тот, для которого пришёл ответ: смена настроек без ответа ничего не объявляет
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [freshStamp]);
  const mobile = useIsMobile();
  const accounts = useAccounts(company.id);
  const categories = useCategories(company.id);
  const projects = useProjects(company.id);
  const counterparties = useCounterparties(company.id);
  const tags = useTags(company.id);
  // окно «Фильтры»: на телефоне в нём ещё контролы отчёта (§2.2); режим запоминается при открытии
  const [filterOpen, setFilterOpen] = useState<false | "phone" | "desktop">(
    false,
  );
  // ячейка, по которой открыт список операций (§2.5); заголовок запоминается при щелчке
  const [cell, setCell] = useState<{
    row: string;
    col: string;
    title: string;
  } | null>(null);
  // другие настройки отчёта — прежняя ячейка к ним не относится: список закрывается
  useEffect(() => setCell(null), [apiParams]);
  const lookups = useMemo<JournalLookups | null>(() => {
    if (
      !accounts.data ||
      !categories.data ||
      !projects.data ||
      !counterparties.data
    )
      return null;
    return {
      accounts: new Map(accounts.data.map((a) => [a.id, a])),
      categories: categoryLookup(categories.data),
      projects: new Map(projects.data.map((p) => [p.id, p.name])),
      counterparties: new Map(counterparties.data.map((c) => [c.id, c.name])),
    };
  }, [accounts.data, categories.data, projects.data, counterparties.data]);

  // настройки меняют адрес без новой записи в истории: «Назад» уводит со страницы, а не по шагам настроек
  const update = (next: ReportUrlState) =>
    setParams(reportSearch(next), { replace: true });
  const range = today ? reportRange(state, today) : null;
  // точка у «Шага» — по действующему шагу: из адреса можно получить шаг, который на этом периоде заменяется другим
  const step = range ? effectiveStep(state.step, range) : state.step;
  const changed = {
    ...changedControls(state),
    step: step !== DEFAULT_REPORT_STATE.step,
  };

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
          <h1
            ref={headingRef}
            tabIndex={-1}
            className="text-2xl font-bold outline-none"
          >
            Деньги
          </h1>
          <HelpButton about="Деньги" text={HELP} />
        </div>
        <p className="text-sm text-muted">
          Отчёт о движении денежных средств (cash flow)
        </p>
      </div>
    </div>
  );

  const dictionaries = [
    meta,
    accounts,
    categories,
    projects,
    counterparties,
    tags,
  ];
  if (!today || !range || !timeZone || !lookups || !tags.data) {
    return (
      <section>
        {header}
        <Pending queries={dictionaries} />
      </section>
    );
  }
  const closeCell = () => {
    const key = cell && cellKey(cell.row, cell.col);
    setCell(null);
    // фокус — в ячейку, из которой открыли список (если она ещё в таблице), иначе на заголовок отчёта
    requestAnimationFrame(() =>
      (
        document.querySelector<HTMLElement>(
          `[data-cell="${CSS.escape(key ?? "")}"]`,
        ) ?? headingRef.current
      )?.focus(),
    );
  };
  const cellParams = (c: { row: string; col: string }) => {
    const p = new URLSearchParams(apiParams ?? "");
    p.set("report", "cashflow");
    p.set("row", c.row);
    p.set("col", c.col);
    return p.toString();
  };

  return (
    <section>
      {header}
      {/* область есть, пока справочники загружены, и пуста до первого ответа: первое объявление тоже читается (как «итог выделения» журнала) */}
      <p role="status" aria-live="polite" className="sr-only">
        {announcement}
      </p>
      {/* панель контролов прилипает к верху при прокрутке (§2.2); на телефоне сверху только «Фильтры», остальное — в окне */}
      <div className="sticky top-0 z-20 -mx-4 mb-4 flex flex-wrap items-center gap-2 bg-card px-4 py-2 md:-mx-8 md:px-8">
        {/* телефон: число изменённых настроек вместо точек */}
        <button
          type="button"
          aria-haspopup="dialog"
          onClick={() => setFilterOpen("phone")}
          className="inline-flex min-h-11 items-center gap-1.5 rounded-full bg-field px-4 text-sm font-semibold text-ink hover:brightness-95 focus-visible:outline-2 focus-visible:outline-focus md:hidden"
        >
          <FunnelIcon />
          {`Фильтры${phoneReportCount(state) > 0 ? ` · ${phoneReportCount(state)}` : ""}`}
        </button>
        <div className="contents max-md:hidden">
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
            <ChoiceMenu
              name="Разрез"
              value={state.by}
              options={BY_CHOICES}
              onChange={(by) => update({ ...state, by })}
            />
          </ChangedMark>
          <ChangedMark on={changed.step}>
            <ChoiceMenu
              name="Шаг"
              value={step}
              options={stepChoices(range)}
              onChange={(s) => update({ ...state, step: s })}
            />
          </ChangedMark>
          <ChangedMark on={changed.filter}>
            <button
              type="button"
              aria-haspopup="dialog"
              onClick={() => setFilterOpen("desktop")}
              className="inline-flex items-center gap-1.5 rounded-full bg-field px-4 py-2 text-sm font-semibold text-ink hover:brightness-95 focus-visible:outline-2 focus-visible:outline-focus"
            >
              <FunnelIcon />
              {`Фильтр${changed.filter ? ` · ${reportFilterCount(state)}` : ""}`}
            </button>
          </ChangedMark>
          <ChangedMark on={changed.percent}>
            <ChoiceMenu
              name="Проценты"
              value={state.percent ? "on" : "off"}
              options={PERCENT_CHOICES}
              onChange={(v) => update({ ...state, percent: v === "on" })}
            />
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
          {Object.values(changed).some(Boolean) && (
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
      </div>
      <ReportFilterDialog
        open={filterOpen !== false}
        phone={filterOpen === "phone"}
        today={today}
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
          <button
            type="button"
            onClick={() => void report.refetch()}
            className={btnSecondary}
          >
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
          active={cell}
          onCell={(row, column) =>
            setCell({
              row: row.id,
              col: column?.key ?? "total",
              title: cellTitle(row, column),
            })
          }
        />
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
          onClose={closeCell}
        />
      )}
    </section>
  );
}
