import { useEffect, useState } from 'react';
import { useOutletContext } from 'react-router';
import { CLUB_DASHBOARDS } from '../../../shared/analytics-catalog';
import { StackedBars } from '../../components/charts/StackedBars';
import { CohortTable } from '../../components/club/CohortTable';
import { GuestsTable } from '../../components/club/GuestsTable';
import { Tile } from '../../components/club/Tile';
import { shareText, unassignedText, type GuestsView } from '../../lib/club-guests';
import type { ClubView } from '../../lib/club-url';
import type { CompanyOutletContext } from '../CompanyLayout';
import { ClubReportScreen, type ClubReportContext } from './ClubReportScreen';

const CARD = CLUB_DASHBOARDS.find((d) => d.key === 'guests')!;
const TITLE = CARD.title;
const HELP = `${CARD.help} Логины, у которых за 90 дней больше 3 разных телефонов, — общие: они не связывают гостей.`;
/** График — вид по умолчанию (R13); шаг — только в графике. */
const VIEWS: readonly ClubView[] = ['chart', 'table'];
const CHART_ONLY: readonly ClubView[] = ['chart'];
const count = (v: number) => v.toLocaleString('ru-RU');

/** «Возраст» (§7.2): доля гостей периода по корзинам возраста. */
function Ages(props: { ages: GuestsView['ages'] }) {
  if (props.ages.every((a) => a.count === 0)) return null;
  return (
    <section className="mt-6">
      <h2 className="mb-2 text-base font-bold text-ink">Возраст</h2>
      <ul className="flex flex-col gap-1 text-sm">
        {props.ages.map((a) => (
          <li key={a.label}>{`${a.label} — ${shareText(a.share)}`}</li>
        ))}
      </ul>
    </section>
  );
}

/** Плитки, график новых и вернувшихся или таблица постоянных гостей; под ними — когорты и возраст. */
function GuestsBody({ ctx }: { ctx: ClubReportContext<GuestsView> }) {
  const { data, state } = ctx;
  const [open, setOpen] = useState<string | null>(null);
  useEffect(() => setOpen(null), [ctx.apiParams]);
  const unassigned = unassignedText(data.unassigned);
  const body =
    state.view === 'table' ? (
      <GuestsTable title={TITLE} rows={data.top} busy={ctx.busy} timeZone={ctx.timeZone} open={open} onOpen={(ref) => setOpen(open === ref ? null : ref)} />
    ) : (
      <StackedBars
        title="Новые и вернувшиеся гости"
        columns={data.columns}
        series={data.series.map((s, i) => ({ id: s.id, label: s.label, color: i, values: s.values.map((v) => v ?? 0) }))}
        currency="KZT"
        format={count}
        selected={null}
        onSelect={() => undefined}
        busy={ctx.busy}
      />
    );
  return (
    <>
      {data.firstDaysNote && <p className="mb-3 rounded-lg bg-field px-3 py-2 text-sm text-ink">{data.firstDaysNote}</p>}
      <ul aria-label="Плитки" className={`mb-3 grid grid-cols-2 gap-3 md:grid-cols-4 ${ctx.busy ? 'opacity-60' : ''}`}>
        {data.tiles.map((t) => (
          <li key={t.key} className="contents">
            <Tile tile={t} to={null} compare={state.compare} />
          </li>
        ))}
      </ul>
      {unassigned && <p className="mb-4 text-sm text-muted">{unassigned}</p>}
      {body}
      <CohortTable rows={data.cohorts} busy={ctx.busy} />
      <Ages ages={data.ages} />
    </>
  );
}

/** «Гости» (спецификация «Аналитика клуба», §7). Экран создаётся заново при смене компании (key). */
export function ClubGuestsPage() {
  const { company } = useOutletContext<CompanyOutletContext>();
  return (
    <ClubReportScreen<GuestsView> key={company.id} company={company} title={TITLE} subtitle={CARD.description} help={HELP} report="guests" stepIn={CHART_ONLY} views={VIEWS} excel>
      {(ctx) => <GuestsBody ctx={ctx} />}
    </ClubReportScreen>
  );
}
