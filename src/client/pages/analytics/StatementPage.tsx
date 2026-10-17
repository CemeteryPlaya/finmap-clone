import { useId, useRef } from 'react';
import { Link, useOutletContext } from 'react-router';
import { formatDateRu } from '../../../shared/dates';
import { formatMoney, MONEY_SCREEN_BEFORE } from '../../../shared/money';
import { STATEMENT_SUMMARY } from '../../../shared/report-statement';
import { ChangedMark, ChoiceMenu } from '../../components/analytics/ChoiceMenu';
import { ExcelLink, RefreshButton, ReportHeader, ReportLoading } from '../../components/analytics/ReportParts';
import { REPORT_OPERATION_COLUMNS } from '../../components/analytics/ReportOperations';
import { HelpButton } from '../../components/HelpButton';
import { JournalCards } from '../../components/journal/JournalCards';
import { JournalTable } from '../../components/journal/JournalTable';
import { LoadMore } from '../../components/journal/LoadMore';
import { PeriodMenu } from '../../components/journal/PeriodMenu';
import { useOpenOperationForm } from '../../components/operation/OperationFormHost';
import { Pending, StaleNotice } from '../../components/QueryState';
import { useStatement, type StatementData } from '../../lib/analytics';
import { uniqueById } from '../../lib/journal-format';
import { useIsMobile } from '../../lib/media';
import type { Company } from '../../lib/queries';
import { useReportSettings } from '../../lib/report-settings';
import { customRangeError, DEFAULT_REPORT_STATE, REPORT_PERIODS, resetReportState } from '../../lib/report-url';
import { statementAccountChoices, statementAccountId, statementApiParams, statementExcelHref, statementState } from '../../lib/statement';
import type { CompanyOutletContext } from '../CompanyLayout';

const TITLE = 'Выписка по счету';
const HELP =
  'Все деньги, которые приходили и уходили по одному счёту: поступления, списания и переводы за выбранный период, с остатком после каждой операции. Удобно сверить с выпиской банка или быстро найти платёж.';

/**
 * «Выписка по счету» (§6 спецификации «Аналитика»): один счёт (по умолчанию первый неархивный; архивный — только выбранный
 * ссылкой), период по дате платежа, сводка в валюте счёта и операции новые сверху с остатком после каждой. Щелчок по
 * операции открывает её форму; после сохранения выписка перечитывается (invalidateAnalytics). Счёт и период — в адресе.
 */
function StatementScreen({ company }: { company: Company }) {
  const settings = useReportSettings(company, { stock: false, normalize: statementState });
  const { state, today, timeZone, notice, update, lookups } = settings;
  const accounts = settings.accounts;
  const accountId = accounts ? statementAccountId(state, accounts) : null;
  const apiParams = today && settings.ready && accountId !== null ? statementApiParams(state, accountId, today).toString() : null;
  const list = useStatement(company.id, apiParams);
  const mobile = useIsMobile();
  const openForm = useOpenOperationForm();
  const headingRef = useRef<HTMLHeadingElement>(null);
  const summaryId = useId();
  const help = <HelpButton about={TITLE} text={HELP} />;
  const header = <ReportHeader companyId={company.id} title={TITLE} subtitle="Все поступления, списания и переводы одного счёта" headingRef={headingRef} help={help} />;

  const filterData = settings.filterData;
  // «?» компьютера живёт в панели; пока панели нет — под заголовком
  const deskHelp = <div className="mb-2 flex justify-end max-md:hidden">{help}</div>;
  if (!today || !timeZone || !lookups || !accounts || !filterData) {
    return (
      <section>
        {header}
        {deskHelp}
        <Pending queries={settings.dictionaries} />
      </section>
    );
  }
  if (accountId === null) {
    return (
      <section>
        {header}
        {deskHelp}
        <p className="py-6 text-muted">
          Нет счетов для выписки.{' '}
          <Link to={`/c/${company.id}/settings/accounts`} className="font-semibold text-ink underline">
            Добавить счёт
          </Link>
        </p>
      </section>
    );
  }

  // первая страница — со счётом и сводкой; пока грузится другой счёт или период, на экране прежняя выписка (busy)
  const first = list.data?.pages[0] as StatementData | undefined;
  const items = uniqueById(list.data?.pages.flatMap((p) => p.items) ?? []);
  const busy = list.isPlaceholderData;
  const changed = state.period !== DEFAULT_REPORT_STATE.period;
  const open = (item: { id: number }) => openForm({ kind: 'edit', id: item.id, focusAfterDelete: () => headingRef.current });
  const iconSize = 'size-8 max-md:size-11';

  return (
    <section>
      {header}
      {/* панель прилипает к верху (§2.2); у выписки два контрола — счёт и период — они и на телефоне остаются в панели */}
      <div className="sticky top-0 z-20 -mx-4 mb-4 flex flex-wrap items-center gap-2 bg-card px-4 py-2 md:-mx-8 md:gap-1.5 md:px-8">
        <ChoiceMenu name="Счёт" value={String(accountId)} options={statementAccountChoices(accounts, accountId)} onChange={(v) => update({ ...state, accountIds: [Number(v)] })} />
        <ChangedMark on={changed}>
          <PeriodMenu state={state} today={today} periods={REPORT_PERIODS} heading="По дате платежа" validate={customRangeError} onChange={update} />
        </ChangedMark>
        {changed && (
          <button
            type="button"
            onClick={() => {
              // счёт — то, о чём выписка, а не настройка: «Сбросить» возвращает только период
              update({ ...resetReportState(state), accountIds: state.accountIds });
              headingRef.current?.focus();
            }}
            className="text-sm font-semibold text-muted underline hover:text-ink"
          >
            Сбросить
          </button>
        )}
        <div className="ml-auto flex shrink-0 items-center gap-1">
          <ExcelLink size={iconSize} href={statementExcelHref(company.id, state, accountId, today)} />
          <RefreshButton size={iconSize} spinning={list.isFetching && !list.isFetchingNextPage} onClick={() => void list.refetch()} />
          <span className="contents max-md:hidden">{help}</span>
        </div>
      </div>
      {notice && (
        <p role="status" className="mb-3 rounded-lg bg-field px-3 py-2 text-sm text-ink">
          {notice}
        </p>
      )}
      <StaleNotice queries={list.data ? [list] : []} />
      {!first ? (
        <ReportLoading error={list.error} onRetry={() => void list.refetch()} />
      ) : (
        <div aria-busy={busy} className={busy ? 'opacity-60' : ''}>
          <section aria-labelledby={summaryId} className="mb-6">
            <h2 id={summaryId} className="sr-only">
              {`Сводка: ${first.account.name}`}
            </h2>
            {/* сводка (§6) — в валюте счёта: конец = начало + поступления - списания + переводы на счёт - со счёта */}
            <dl className="grid grid-cols-2 gap-x-6 gap-y-3 sm:grid-cols-3 xl:grid-cols-6">
              {STATEMENT_SUMMARY.map(({ key, label }) => (
                <div key={key} data-summary={key} className="min-w-0">
                  <dt className="text-xs text-muted">{label}</dt>
                  <dd className={`truncate text-base font-semibold tabular-nums ${first.summary[key] < 0 ? 'text-expense-strong' : 'text-ink'}`}>
                    {formatMoney(first.summary[key], first.account.currency, MONEY_SCREEN_BEFORE)}
                  </dd>
                </div>
              ))}
            </dl>
            {/* счёт открыт внутри периода (R2): стартовый остаток уже в остатке на начало */}
            {first.account.openedAt > first.meta.from && (
              <p data-opened-note className="mt-3 text-sm text-muted">
                {`Счёт открыт ${formatDateRu(first.account.openedAt)} — стартовый остаток учтён в остатке на начало`}
              </p>
            )}
          </section>
          {items.length === 0 ? (
            <p className="py-6 text-center text-muted">Операций за период нет.</p>
          ) : mobile ? (
            <JournalCards
              items={items}
              lookups={lookups}
              baseCurrency={company.baseCurrency}
              timeZone={timeZone}
              busy={busy}
              statementAccountId={first.account.id}
              label={`Операции: ${first.account.name}`}
              onOpenOperation={open}
            />
          ) : (
            <JournalTable
              items={items}
              columns={REPORT_OPERATION_COLUMNS}
              wrap={false}
              statementAccountId={first.account.id}
              caption={`Операции: ${first.account.name}`}
              lookups={lookups}
              baseCurrency={company.baseCurrency}
              timeZone={timeZone}
              today={today}
              projectFilter={[]}
              busy={busy}
              onOpenOperation={open}
            />
          )}
          <LoadMore hasNext={list.hasNextPage} loading={list.isFetchingNextPage} failed={list.isFetchNextPageError} onLoad={() => void list.fetchNextPage()} />
        </div>
      )}
    </section>
  );
}

/** Маршрут не пересоздаёт страницу при смене компании — экран с key. */
export function StatementPage() {
  const { company } = useOutletContext<CompanyOutletContext>();
  return <StatementScreen key={company.id} company={company} />;
}
