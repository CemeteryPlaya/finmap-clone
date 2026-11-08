import { useMemo, useRef, useState, type ReactNode } from 'react';
import { ChangedMark, ChoiceMenu, type Choice } from '../../components/analytics/ChoiceMenu';
import { ExcelLink, RefreshButton, ReportHeader, ReportLoading } from '../../components/analytics/ReportParts';
import { ViewSwitch } from '../../components/analytics/ViewSwitch';
import { CoverageBanner } from '../../components/club/CoverageBanner';
import { HelpButton } from '../../components/HelpButton';
import { FunnelIcon } from '../../components/icons';
import { PeriodMenu } from '../../components/journal/PeriodMenu';
import { Modal } from '../../components/Modal';
import { Pending, StaleNotice } from '../../components/QueryState';
import { btnPrimary, phoneFullScreenModal } from '../../components/ui';
import { useClubScope } from '../../lib/analytics';
import { compareLabel, coverageNote, freshnessLabel, useClubReport, useClubSettings, type ClubReportBase, type ClubReportKind } from '../../lib/club-analytics';
import {
  clubApiParams,
  clubChanged,
  clubChangedFor,
  clubChoices,
  COMPARE_CHOICES,
  knownProject,
  resetClubState,
  withClubStep,
  type ClubUrlState,
  type ClubView,
} from '../../lib/club-url';
import type { Company } from '../../lib/queries';
import { customRangeError, effectiveStep, REPORT_PERIODS, reportRange, stepChoices } from '../../lib/report-url';

/** Что получает содержимое отчёта клуба: настройки, параметры API, ответ (уже есть и данные за период не пусты). */
export interface ClubReportContext<T> {
  state: ClubUrlState;
  apiParams: string;
  data: T;
  /** Пока виден прежний ответ — ячейки не выбираются, данные бледнее. */
  busy: boolean;
  update(s: ClubUrlState): void;
  timeZone: string;
  today: string;
}

/** Контролы отчёта клуба: на компьютере — пилюли панели, на телефоне — в окне «Фильтры» (wide). */
function Controls(props: {
  state: ClubUrlState;
  today: string;
  clubs: Choice<string>[];
  byChoices: readonly Choice<string>[];
  changed: ReturnType<typeof clubChanged>;
  wide?: boolean;
  /** Показать контрол «Шаг». */
  stepShown?: boolean;
  onChange: (next: ClubUrlState) => void;
}) {
  const { state, today, changed, wide } = props;
  const range = reportRange(state, today);
  const mark = (on: boolean, node: ReactNode) => (wide ? node : <ChangedMark on={on}>{node}</ChangedMark>);
  return (
    <>
      {props.clubs.length > 0 &&
        mark(
          changed.project,
          <ChoiceMenu
            wide={wide}
            name="Клуб"
            value={state.project === null ? 'all' : String(state.project)}
            options={props.clubs}
            onChange={(v) => props.onChange({ ...state, project: v === 'all' ? null : Number(v) })}
          />,
        )}
      {mark(
        changed.period,
        <PeriodMenu wide={wide} state={state} today={today} periods={REPORT_PERIODS} validate={customRangeError} onChange={(next) => props.onChange(withClubStep(next, today))} />,
      )}
      {props.stepShown !== false &&
        mark(
          changed.step,
          <ChoiceMenu wide={wide} name="Шаг" value={effectiveStep(state.step, range)} options={stepChoices(range)} onChange={(step) => props.onChange({ ...state, step })} />,
        )}
      {mark(
        changed.compare,
        <ChoiceMenu wide={wide} name="Сравнение" value={state.compare ? 'on' : 'off'} options={COMPARE_CHOICES} onChange={(v) => props.onChange({ ...state, compare: v === 'on' })} />,
      )}
      {props.byChoices.length > 0 &&
        mark(changed.by, <ChoiceMenu wide={wide} name="Разрез" value={state.by} options={props.byChoices} onChange={(by) => props.onChange({ ...state, by })} />)}
    </>
  );
}

/** Окно «Фильтры» телефона (§2.2): контролы отчёта в черновике; «Готово» применяет, «Сбросить» — умолчания, вид остаётся. */
function PhoneFilters(props: {
  state: ClubUrlState;
  today: string;
  clubs: Choice<string>[];
  byChoices: readonly Choice<string>[];
  byValues: readonly string[];
  stepShown?: boolean;
  onApply: (next: ClubUrlState) => void;
}) {
  const [draft, setDraft] = useState(props.state);
  const changed = clubChangedFor(draft, props.byValues, reportRange(draft, props.today), props.stepShown);
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        props.onApply(withClubStep(draft, props.today));
      }}
    >
      <div className="mb-3 flex flex-col gap-3">
        <Controls wide state={draft} today={props.today} clubs={props.clubs} byChoices={props.byChoices} changed={changed} stepShown={props.stepShown} onChange={setDraft} />
      </div>
      <div className="mt-4 flex flex-wrap items-center gap-3 max-md:sticky max-md:bottom-0 max-md:z-10 max-md:-mx-6 max-md:bg-card max-md:px-6 max-md:py-3">
        <button type="submit" className={`${btnPrimary} max-md:basis-full`}>
          Готово
        </button>
        <button type="button" onClick={() => setDraft((d) => resetClubState(d, props.byValues))} className="text-sm font-semibold text-muted underline hover:text-ink">
          Сбросить
        </button>
      </div>
    </form>
  );
}

const NO_CHOICES: readonly Choice<string>[] = [];

/**
 * Страница отчёта клуба (спецификация «Аналитика клуба», §2.2): заголовок с видом, подпись свежести данных Senet, панель
 * контролов (клуб, период, шаг, сравнение, разрез, «Сбросить», справа «Excel», «Обновить» и «?»), на телефоне — окно
 * «Фильтры». Отчёт запрашивается здесь: над ним — полоса дней без данных (§3.3), без данных за период — пустое состояние;
 * само содержимое рисует children. Настройки — в адресе.
 */
export function ClubReportScreen<T extends ClubReportBase>(props: {
  company: Company;
  title: string;
  subtitle: string;
  help: string;
  report: ClubReportKind;
  byChoices?: readonly Choice<string>[];
  views: readonly ClubView[];
  /** Виды, в которых действует разрез («Выручка»: только «таблица»); в остальных — разрез по умолчанию, контрола нет. */
  byIn?: readonly ClubView[];
  /** Ссылка «Excel» — у отчётов с файлом. */
  excel?: boolean;
  /** Виды, в которых виден контрол «Шаг» (не задано — во всех): «Обзор» — ни в одном (§4), «Загрузка» — в «графике». */
  stepIn?: readonly ClubView[];
  children: (ctx: ClubReportContext<T>) => ReactNode;
}) {
  const byChoices = props.byChoices ?? NO_CHOICES;
  const byValues = useMemo(() => byChoices.map((c) => c.value), [byChoices]);
  const scope = useClubScope(props.company.id);
  const settings = useClubSettings(byValues, props.views);
  const { today, timeZone } = settings;
  const projects = scope.data?.projects;
  const state = projects ? knownProject(settings.state, projects) : settings.state;
  const byApplies = !props.byIn || props.byIn.includes(state.view);
  // в виде без разреза запрос и точки — с разрезом по умолчанию; выбранный разрез остаётся в адресе для «таблицы»
  const effective = byApplies ? state : { ...state, by: byValues[0] ?? '' };
  const shownBy = byApplies ? byChoices : NO_CHOICES;
  const stepShown = !props.stepIn || props.stepIn.includes(state.view);
  const apiParams = today && projects ? clubApiParams(effective, today).toString() : null;
  const report = useClubReport<T>(props.company.id, props.report, apiParams);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const [phoneOpen, setPhoneOpen] = useState(false);
  const update = settings.update;

  const help = <HelpButton about={props.title} text={props.help} />;
  const header = (
    <>
      <ReportHeader
        companyId={props.company.id}
        title={props.title}
        subtitle={props.subtitle}
        headingRef={headingRef}
        help={help}
        aside={props.views.length > 1 && <ViewSwitch views={props.views} value={state.view} onChange={(view) => update({ ...state, view })} />}
      />
      {scope.data && timeZone && freshnessLabel(scope.data.freshness, timeZone) && (
        <p className="-mt-3 mb-4 pl-13 text-xs text-muted">{freshnessLabel(scope.data.freshness, timeZone)}</p>
      )}
    </>
  );
  if (!today || !timeZone || !projects || !apiParams) {
    return (
      <section>
        {header}
        <Pending queries={[scope]} />
      </section>
    );
  }

  const range = reportRange(state, today);
  const changed = clubChangedFor(effective, byValues, range, stepShown);
  const changedCount = Object.values(changed).filter(Boolean).length;
  const clubs = clubChoices(projects);
  const refresh = (size: string) => <RefreshButton size={size} spinning={report.isFetching} onClick={() => void report.refetch()} />;
  const excel = (size: string) =>
    props.excel && <ExcelLink size={size} href={`/api/v1/companies/${props.company.id}/club-analytics/${props.report}.xlsx?${apiParams}`} />;
  const data = report.data;
  const empty = data ? coverageNote(data.coverage, today)?.kind === 'empty' : false;

  return (
    <section>
      {header}
      {/* панель прилипает к верху при прокрутке; на телефоне сверху вид, «Фильтры», «Excel» и «Обновить», остальное — в окне */}
      <div className="sticky top-0 z-20 -mx-4 mb-4 flex flex-wrap items-center gap-2 bg-card px-4 py-2 md:-mx-8 md:gap-1.5 md:px-8">
        {props.views.length > 1 && (
          <span className="contents md:hidden">
            <ViewSwitch phone views={props.views} value={state.view} onChange={(view) => update({ ...state, view })} />
          </span>
        )}
        <button
          type="button"
          aria-haspopup="dialog"
          onClick={() => setPhoneOpen(true)}
          className="inline-flex min-h-11 items-center gap-1.5 rounded-full bg-field px-4 text-sm font-semibold text-ink hover:brightness-95 focus-visible:outline-2 focus-visible:outline-focus md:hidden"
        >
          <FunnelIcon />
          {`Фильтры${changedCount > 0 ? ` · ${changedCount}` : ''}`}
        </button>
        <span className="contents md:hidden">
          {excel('size-11')}
          {refresh('size-11')}
        </span>
        <div className="contents max-md:hidden md:[&_button.bg-field:not(.size-8)]:px-3">
          <Controls state={state} today={today} clubs={clubs} byChoices={shownBy} changed={changed} stepShown={stepShown} onChange={update} />
          {changedCount > 0 && (
            <button
              type="button"
              onClick={() => {
                update(resetClubState(state, byValues));
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
      <Modal open={phoneOpen} title="Фильтры" onClose={() => setPhoneOpen(false)} className={`max-w-[818px] max-md:scroll-pb-44 ${phoneFullScreenModal}`} phoneFullScreen>
        <PhoneFilters
          state={state}
          today={today}
          clubs={clubs}
          byChoices={shownBy}
          byValues={byValues}
          stepShown={stepShown}
          onApply={(next) => {
            update(next);
            setPhoneOpen(false);
          }}
        />
      </Modal>
      <StaleNotice queries={data ? [report] : []} />
      {!data ? (
        <ReportLoading error={report.error} onRetry={() => void report.refetch()} />
      ) : (
        <>
          <CoverageBanner coverage={data.coverage} companyId={props.company.id} today={today} />
          {state.compare && compareLabel(data.prevRange) && <p className="mb-3 text-xs text-muted">{compareLabel(data.prevRange)}</p>}
          {!empty && props.children({ state: effective, apiParams, data, busy: report.isPlaceholderData, update, timeZone, today })}
        </>
      )}
    </section>
  );
}
