import { useEffect, useState } from 'react';
import { useOutletContext } from 'react-router';
import { CLUB_DASHBOARDS } from '../../../shared/analytics-catalog';
import { HelpButton } from '../../components/HelpButton';
import type { Choice } from '../../components/analytics/ChoiceMenu';
import { StackedBars } from '../../components/charts/StackedBars';
import { BarTable } from '../../components/club/BarTable';
import { ClubRows } from '../../components/club/ClubRows';
import { Tile } from '../../components/club/Tile';
import { noCostText, type BarView } from '../../lib/club-bar';
import { clubMoney } from '../../lib/club-revenue';
import type { ClubView } from '../../lib/club-url';
import type { CompanyOutletContext } from '../CompanyLayout';
import { ClubReportScreen, type ClubReportContext } from './ClubReportScreen';

const CARD = CLUB_DASHBOARDS.find((d) => d.key === 'bar')!;
const TITLE = CARD.title;
const BY_CHOICES: readonly Choice<string>[] = [
  { value: 'items', label: 'По товарам' },
  { value: 'categories', label: 'По категориям' },
];
/** График — вид по умолчанию (R13); шаг — только в графике, разрез — только в таблице (§8.3). */
const VIEWS: readonly ClubView[] = ['chart', 'table'];
const CHART_ONLY: readonly ClubView[] = ['chart'];
const TABLE_ONLY: readonly ClubView[] = ['table'];
const DIFF_HINT = 'покупка не заведена приходом в Senet или приход без выемки';

/** «Закупки» (§8.2): из кассы, приход в Senet и разница с подсказкой. */
function Purchases(props: { data: BarView['purchases'] }) {
  const p = props.data;
  return (
    <section className="mt-6">
      <h2 className="mb-2 text-base font-bold text-ink">Закупки</h2>
      <dl className="grid max-w-md grid-cols-[1fr_auto] gap-x-4 gap-y-1 text-sm">
        <dt>Закуплено из кассы</dt>
        <dd className="text-right tabular-nums">{clubMoney(p.desk)}</dd>
        <dt>Приход в Senet по цене прихода</dt>
        <dd className="text-right tabular-nums">{clubMoney(p.restock)}</dd>
        <dt className="flex items-center gap-1">
          Разница
          {p.diff !== 0 && <HelpButton about="Разница закупок" text={DIFF_HINT} />}
        </dt>
        <dd className="text-right font-semibold tabular-nums">{clubMoney(p.diff)}</dd>
      </dl>
    </section>
  );
}

/** Плитки, график себестоимости и прибыли или таблица товаров; под таблицей — продажи выбранного товара; ниже — закупки. */
function BarBody({ ctx, companyId }: { ctx: ClubReportContext<BarView>; companyId: number }) {
  const { data, state } = ctx;
  const [open, setOpen] = useState<string | null>(null);
  useEffect(() => setOpen(null), [ctx.apiParams, state.view]);
  const rowsParams = (item: string) => {
    const p = new URLSearchParams(ctx.apiParams);
    p.set('item', item);
    return p.toString();
  };
  const noCost = noCostText(data.noCost);
  const body =
    state.view === 'table' ? (
      <>
        <BarTable title={TITLE} data={data} by={data.meta.by} busy={ctx.busy} open={open} onOpen={(item) => setOpen(open === item ? null : item)} />
        {noCost && <p className="mt-2 text-sm text-muted">{noCost}</p>}
      </>
    ) : (
      <StackedBars
        title="Выручка и прибыль бара"
        columns={data.columns}
        series={data.series.map((s, i) => ({ id: s.id, label: s.label, color: i, values: s.values.map((v) => v ?? 0) }))}
        currency="KZT"
        selected={null}
        onSelect={() => undefined}
        busy={ctx.busy}
      />
    );
  return (
    <>
      <ul aria-label="Плитки" className={`mb-4 grid grid-cols-2 gap-3 md:grid-cols-4 ${ctx.busy ? 'opacity-60' : ''}`}>
        {data.tiles.map((t) => (
          <li key={t.key} className="contents">
            <Tile tile={t} to={null} compare={state.compare} />
          </li>
        ))}
      </ul>
      {body}
      {state.view === 'table' && data.meta.by === 'items' && open && (
        <ClubRows
          companyId={companyId}
          report="bar"
          title={`Продажи: ${open}`}
          params={rowsParams(open)}
          timeZone={ctx.timeZone}
          onClose={() => {
            setOpen(null);
            document.querySelector<HTMLElement>('h1')?.focus();
          }}
        />
      )}
      <Purchases data={data.purchases} />
    </>
  );
}

/** «Бар» (спецификация «Аналитика клуба», §8). Экран создаётся заново при смене компании (key). */
export function ClubBarPage() {
  const { company } = useOutletContext<CompanyOutletContext>();
  return (
    <ClubReportScreen<BarView>
      key={company.id}
      company={company}
      title={TITLE}
      subtitle={CARD.description}
      help={CARD.help}
      report="bar"
      byChoices={BY_CHOICES}
      byIn={TABLE_ONLY}
      stepIn={CHART_ONLY}
      views={VIEWS}
      excel
    >
      {(ctx) => <BarBody ctx={ctx} companyId={company.id} />}
    </ClubReportScreen>
  );
}
