import { useEffect, useId, useState } from 'react';
import { Link, useOutletContext } from 'react-router';
import { localParts } from '../../../shared/club-analytics/hours';
import type { ReportColumn } from '../../../shared/report-engine';
import type { Choice } from '../../components/analytics/ChoiceMenu';
import { BarsLineChart } from '../../components/charts/BarsLineChart';
import { ClubRows } from '../../components/club/ClubRows';
import { ClubTable } from '../../components/club/ClubTable';
import { HoursHeatmap } from '../../components/club/HoursHeatmap';
import type { ClubView } from '../../lib/club-url';
import { chartSeries, clubMoney, reconcileTotal, revenueApprox, revenueCellRow, revenueCellTitle, shiftHref, type RevenueView } from '../../lib/club-revenue';
import type { Company } from '../../lib/queries';
import type { CompanyOutletContext } from '../CompanyLayout';
import { ClubReportScreen, type ClubReportContext } from './ClubReportScreen';

const TITLE = 'Выручка клуба';
const HELP =
  'Выручка — то, что гости потратили: часы (абонементы и аренда ПК) и бар. Деньги в кассу, пополнения балансов и разница с выручкой — справочные строки: пополненное, но ещё не потраченное, лежит на балансах гостей. Данные — из Senet.';
const BY_CHOICES: readonly Choice<string>[] = [
  { value: 'parts', label: 'По частям' },
  { value: 'payment', label: 'По способу оплаты' },
  { value: 'shifts', label: 'По сменам' },
  { value: 'cashiers', label: 'По кассирам' },
];
const VIEWS: readonly ClubView[] = ['chart', 'table', 'hours'];
const TABLE_ONLY: readonly ClubView[] = ['table'];

/** «Не сходится со сменами: X ₸» (§3.4): над таблицей; щелчок раскрывает смены с разницей и ссылками в «Сверку». */
function ReconcileNote(props: { data: RevenueView; companyId: number; timeZone: string }) {
  const [open, setOpen] = useState(false);
  const listId = useId();
  const shifts = props.data.reconcile.diffShifts;
  if (shifts.length === 0) return null;
  return (
    <div className="mb-4 rounded-lg bg-expense-soft px-3 py-2 text-sm text-ink">
      <button type="button" aria-expanded={open} aria-controls={listId} onClick={() => setOpen((v) => !v)} className="font-semibold underline">
        {`Не сходится со сменами: ${clubMoney(reconcileTotal(shifts))}`}
      </button>
      {open && (
        <ul id={listId} className="mt-2 flex flex-col gap-1">
          {shifts.map((s) => (
            <li key={s.id}>
              <Link to={shiftHref(props.companyId, s.id, localParts(s.openedAt, props.timeZone).day)} className="underline">
                {`Смена ${localParts(s.openedAt, props.timeZone).day.split('-').reverse().join('.')}`}
              </Link>
              {` — ${clubMoney(s.diff)}`}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** Содержимое отчёта: таблица, график или карта часов; список строк Senet под ячейкой или выбранной колонкой графика. */
function RevenueBody({ ctx, company }: { ctx: ClubReportContext<RevenueView>; company: Company }) {
  const { data, state } = ctx;
  // ячейка или колонка графика; настройки отчёта запоминаются: при других настройках прежний список не показывается
  const [picked, setPicked] = useState<{ row: string; col: string; title: string; apiParams: string } | null>(null);
  const cell = picked && picked.apiParams === ctx.apiParams ? picked : null;
  useEffect(() => setPicked(null), [ctx.apiParams, state.view]);
  const approx = revenueApprox(data, ctx.today);
  const pick = (row: { id: string; label: string }, col: ReportColumn | null) => {
    const r = revenueCellRow(row.id);
    if (r) setPicked({ row: r, col: col?.key ?? 'total', title: revenueCellTitle(row, col), apiParams: ctx.apiParams });
  };
  const rowsParams = (c: { row: string; col: string }) => {
    const p = new URLSearchParams(ctx.apiParams);
    p.set('row', c.row);
    p.set('col', c.col);
    return p.toString();
  };
  const close = () => {
    setPicked(null);
    document.querySelector<HTMLElement>('h1')?.focus();
  };

  let body;
  if (state.view === 'hours') {
    body = data.heatmap ? <HoursHeatmap title={TITLE} map={data.heatmap} busy={ctx.busy} /> : null;
  } else if (state.view === 'table') {
    body = <ClubTable title={TITLE} data={data} companyId={company.id} compare={state.compare} approx={approx} busy={ctx.busy} active={cell} onCell={pick} />;
  } else {
    const series = chartSeries(data.rows);
    const selected = cell ? data.columns.findIndex((c) => c.key === cell.col) : -1;
    body = (
      <BarsLineChart
        title={TITLE}
        columns={data.columns}
        income={series.income}
        expense={series.expense}
        line={series.line}
        names={{ income: 'Часы', expense: 'Бар', line: 'Деньги в кассу' }}
        currency="KZT"
        selected={selected < 0 ? null : selected}
        busy={ctx.busy}
        onSelect={(i) => {
          const col = data.columns[i] ?? null;
          if (cell && col && cell.col === col.key) setPicked(null);
          else pick({ id: 'revenue', label: 'Выручка' }, col);
        }}
      />
    );
  }

  return (
    <>
      {state.view !== 'hours' && <ReconcileNote data={data} companyId={company.id} timeZone={ctx.timeZone} />}
      {body}
      {cell && <ClubRows companyId={company.id} title={cell.title} params={rowsParams(cell)} timeZone={ctx.timeZone} onClose={close} />}
    </>
  );
}

/** «Выручка клуба» (спецификация «Аналитика клуба», §5). Экран создаётся заново при смене компании (key). */
export function ClubRevenuePage() {
  const { company } = useOutletContext<CompanyOutletContext>();
  return (
    <ClubReportScreen<RevenueView>
      key={company.id}
      company={company}
      title={TITLE}
      subtitle="На что гости тратят деньги: часы и бар"
      help={HELP}
      report="revenue"
      byChoices={BY_CHOICES}
      byIn={TABLE_ONLY}
      views={VIEWS}
      excel
    >
      {(ctx) => <RevenueBody ctx={ctx} company={company} />}
    </ClubReportScreen>
  );
}
