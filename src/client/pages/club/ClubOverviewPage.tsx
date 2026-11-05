import { Link, useNavigate, useOutletContext } from 'react-router';
import { reportColumns } from '../../../shared/report-engine';
import { PercentLinesChart } from '../../components/charts/PercentLinesChart';
import { Tile } from '../../components/club/Tile';
import { hourLabel } from '../../lib/club-load';
import { bestWorstText, overviewChart, overviewHref, type OverviewView } from '../../lib/club-overview';
import { clubMoney } from '../../lib/club-revenue';
import { clubSearch, DEFAULT_CLUB_STATE, type ClubUrlState, type ClubView } from '../../lib/club-url';
import type { CompanyOutletContext } from '../CompanyLayout';
import { ClubReportScreen, type ClubReportContext } from './ClubReportScreen';

const TITLE = 'Обзор клуба';
const HELP =
  'Главные цифры периода и насколько они изменились по сравнению с прошлым периодом той же длины. Плитка ведёт в свой отчёт с тем же периодом и клубом. Плитки выбираются в «Настройках → Аналитика». Данные — из Senet, «ФОТ к выручке» и «Аренда к выручке» — из журнала.';
const VIEWS: readonly ClubView[] = ['chart'];
const NO_STEP: readonly ClubView[] = [];

/** Адрес отчёта клуба с периодом, клубом и сравнением «Обзора»; вид, шаг и разрез — умолчания отчёта. */
const clubQuery = (state: ClubUrlState) => clubSearch({ ...state, view: DEFAULT_CLUB_STATE.view, step: DEFAULT_CLUB_STATE.step, by: '' }, []).toString();

/** «Выручка клуба» за один день — таблица по дням. */
const dayQuery = (state: ClubUrlState, day: string) => clubSearch({ ...state, view: 'table', period: 'custom', from: day, to: day, step: 'day', by: '' }, []).toString();

function DayList(props: { title: string; days: OverviewView['best']; href: (day: string) => string }) {
  return (
    <section className="min-w-0 flex-1">
      <h3 className="mb-2 text-sm font-semibold text-muted">{props.title}</h3>
      {props.days.length === 0 ? (
        <p className="text-sm text-muted">Нет полных дней с данными</p>
      ) : (
        <ol className="flex flex-col gap-1">
          {props.days.map((d) => (
            <li key={d.day}>
              <Link
                to={props.href(d.day)}
                className="flex justify-between gap-3 rounded-md px-2 py-1.5 text-sm hover:bg-field focus-visible:outline-2 focus-visible:outline-focus"
              >
                <span>{bestWorstText(d.day)}</span>
                <span className="font-semibold tabular-nums">{clubMoney(d.revenue)}</span>
              </Link>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}

/** «Часы пик» (§4): 3 часа недели с наибольшей загрузкой и ссылка на «Загрузку» с периодом и клубом «Обзора». */
function PeakHours(props: { data: OverviewView; href: string }) {
  if (props.data.peak.length === 0) return null;
  return (
    <section className="mb-6">
      <h2 className="mb-2 text-base font-bold text-ink">Часы пик</h2>
      <ol className="mb-2 flex flex-col gap-1 text-sm">
        {props.data.peak.map((c) => (
          <li key={`${c.weekday}-${c.hour}`}>{hourLabel(c)}</li>
        ))}
      </ol>
      <Link to={props.href} className="text-sm font-semibold underline focus-visible:outline-2 focus-visible:outline-focus">
        Загрузка
      </Link>
    </section>
  );
}

/** Плитки, «Выручка и загрузка по дням», «Часы пик» и «Лучшие и худшие дни» (§4). */
function OverviewBody({ ctx, companyId }: { ctx: ClubReportContext<OverviewView>; companyId: number }) {
  const navigate = useNavigate();
  const { data, state } = ctx;
  const club = clubQuery(state);
  const pnl = new URLSearchParams({ from: data.meta.from, to: data.meta.to }).toString();
  const dayHref = (day: string) => overviewHref(companyId, 'club/revenue', dayQuery(state, day), '');
  const columns = reportColumns(data.meta.from, data.meta.to, 'day');
  const chart = overviewChart(data.days);
  return (
    <>
      <ul aria-label="Плитки" className={`mb-6 grid grid-cols-2 gap-3 md:grid-cols-4 ${ctx.busy ? 'opacity-60' : ''}`}>
        {data.tiles.map((t) => (
          <li key={t.key} className="contents">
            <Tile tile={t} to={t.available && t.href ? overviewHref(companyId, t.href, club, pnl) : null} compare={state.compare} />
          </li>
        ))}
      </ul>
      <div className="mb-6">
        <PercentLinesChart
          title="Выручка и загрузка по дням"
          columns={columns}
          bars={{ label: 'Выручка', values: chart.revenue, currency: 'KZT' }}
          lines={[{ id: 'load', label: 'Загрузка', values: chart.load }]}
          busy={ctx.busy}
          onSelect={(i) => {
            const day = data.days[i]?.day;
            if (day) navigate(dayHref(day));
          }}
        />
      </div>
      <PeakHours data={data} href={overviewHref(companyId, 'club/load', club, '')} />
      <h2 className="mb-3 text-base font-bold text-ink">Лучшие и худшие дни</h2>
      <div className="flex gap-6 max-md:flex-col">
        <DayList title="Лучшие" days={data.best} href={dayHref} />
        <DayList title="Худшие" days={data.worst} href={dayHref} />
      </div>
    </>
  );
}

/** «Обзор клуба» (спецификация «Аналитика клуба», §4). Экран создаётся заново при смене компании (key). */
export function ClubOverviewPage() {
  const { company } = useOutletContext<CompanyOutletContext>();
  return (
    <ClubReportScreen<OverviewView>
      key={company.id}
      company={company}
      title={TITLE}
      subtitle="Главные цифры периода и сравнение с прошлым"
      help={HELP}
      report="overview"
      views={VIEWS}
      stepIn={NO_STEP}
      excel
    >
      {(ctx) => <OverviewBody ctx={ctx} companyId={company.id} />}
    </ClubReportScreen>
  );
}
