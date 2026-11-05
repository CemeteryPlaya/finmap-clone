import { Link, useNavigate, useOutletContext } from 'react-router';
import { reportColumns } from '../../../shared/report-engine';
import { StackedBars } from '../../components/charts/StackedBars';
import { Tile } from '../../components/club/Tile';
import { bestWorstText, overviewHref, type OverviewView } from '../../lib/club-overview';
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

/** Плитки, «Выручка по дням» и «Лучшие и худшие дни» (§4). Загрузка на графике и «Часы пик» — с отчётом «Загрузка» (R7). */
function OverviewBody({ ctx, companyId }: { ctx: ClubReportContext<OverviewView>; companyId: number }) {
  const navigate = useNavigate();
  const { data, state } = ctx;
  const club = clubQuery(state);
  const pnl = new URLSearchParams({ from: data.meta.from, to: data.meta.to }).toString();
  const dayHref = (day: string) => overviewHref(companyId, 'club/revenue', dayQuery(state, day), '');
  const columns = reportColumns(data.meta.from, data.meta.to, 'day');
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
        <StackedBars
          title="Выручка по дням"
          columns={columns}
          series={[{ id: 'revenue', label: 'Выручка', color: 0, values: data.days.map((d) => d.revenue ?? 0) }]}
          currency="KZT"
          selected={null}
          busy={ctx.busy}
          onSelect={(i) => {
            const day = data.days[i]?.day;
            if (day) navigate(dayHref(day));
          }}
        />
      </div>
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
