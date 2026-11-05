import { useEffect, useState } from 'react';
import { useOutletContext } from 'react-router';
import type { Choice } from '../../components/analytics/ChoiceMenu';
import { PercentLinesChart } from '../../components/charts/PercentLinesChart';
import { ClubRows } from '../../components/club/ClubRows';
import { HoursHeatmap } from '../../components/club/HoursHeatmap';
import { ZonesTable } from '../../components/club/ZonesTable';
import { hourLabel, loadText, seatsLine, type LoadView } from '../../lib/club-load';
import { WEEKDAYS } from '../../lib/club-revenue';
import type { ClubView } from '../../lib/club-url';
import type { CompanyOutletContext } from '../CompanyLayout';
import { ClubReportScreen, type ClubReportContext } from './ClubReportScreen';

const TITLE = 'Загрузка';
const HELP =
  'Сколько ПК занято: по часам, дням недели и зонам. Загрузка часа — занятое время мест, делённое на число ПК; наложенные сеансы одного места не считаются дважды, идущие сеансы — до закрытия не учитываются. Средние — только по дням с полными данными. Места зон задаются в «Интеграции» → клуб Senet → «Изменить».';
const BY_CHOICES: readonly Choice<string>[] = [
  { value: 'all', label: 'Все зоны' },
  { value: 'zones', label: 'По зонам' },
];
/** Карта — вид по умолчанию (§6.3, R13). */
const VIEWS: readonly ClubView[] = ['hours', 'chart', 'table'];
const CHART_ONLY: readonly ClubView[] = ['chart'];
const hh = (h: number) => `${String(h).padStart(2, '0')}:00`;

/** «Часы простоя» (§6.3): 5 часов недели с наименьшей загрузкой. */
function IdleHours(props: { data: LoadView }) {
  if (props.data.idle.length === 0) return null;
  return (
    <section className="mt-6">
      <h2 className="mb-1 text-base font-bold text-ink">Часы простоя</h2>
      <p className="mb-2 text-sm text-muted">Время для акций</p>
      <ol className="flex flex-col gap-1 text-sm">
        {props.data.idle.map((c) => (
          <li key={`${c.weekday}-${c.hour}`}>{hourLabel(c)}</li>
        ))}
      </ol>
    </section>
  );
}

/** Карта, график или таблица зон; под картой — сеансы выбранного часа недели. */
function LoadBody({ ctx, companyId }: { ctx: ClubReportContext<LoadView>; companyId: number }) {
  const { data, state } = ctx;
  const [picked, setPicked] = useState<{ weekday: number; hour: number; apiParams: string } | null>(null);
  const cell = picked && picked.apiParams === ctx.apiParams ? picked : null;
  useEffect(() => setPicked(null), [ctx.apiParams, state.view]);
  const params = (c: { weekday: number; hour: number }) => {
    const p = new URLSearchParams(ctx.apiParams);
    p.set('weekday', String(c.weekday));
    p.set('hour', String(c.hour));
    return p.toString();
  };

  let body;
  if (state.view === 'table') body = <ZonesTable title={TITLE} zones={data.zones} busy={ctx.busy} />;
  else if (state.view === 'chart') body = <PercentLinesChart title="Загрузка по шагу" columns={data.columns} lines={data.series} busy={ctx.busy} />;
  else {
    body = (
      <HoursHeatmap
        title={TITLE}
        map={data.heatmap}
        busy={ctx.busy}
        format={loadText}
        caption="Средняя загрузка часа по дням с полными данными"
        active={cell}
        onCell={(weekday, hour) => setPicked(cell && cell.weekday === weekday && cell.hour === hour ? null : { weekday, hour, apiParams: ctx.apiParams })}
      />
    );
  }

  return (
    <>
      <p className="mb-1 text-sm text-ink">{seatsLine(data.seats)}</p>
      {data.seats.note && <p className="mb-3 rounded-lg bg-field px-3 py-2 text-sm text-ink">{data.seats.note}</p>}
      {data.meta.noZones && <p className="mb-3 rounded-lg bg-expense-soft px-3 py-2 text-sm text-ink">Senet не прислал сеансы по зонам — проверьте отчёт «Загрузка клуба»</p>}
      <p className="mb-4 text-sm text-muted">{`Загрузка за период: ${loadText(data.total)}`}</p>
      {body}
      {state.view === 'hours' && cell && (
        <ClubRows
          companyId={companyId}
          report="load"
          title={`Сеансы: ${WEEKDAYS[cell.weekday]}, ${hh(cell.hour)}–${hh(cell.hour + 1)}`}
          params={params(cell)}
          timeZone={ctx.timeZone}
          onClose={() => {
            setPicked(null);
            document.querySelector<HTMLElement>('h1')?.focus();
          }}
        />
      )}
      <IdleHours data={data} />
    </>
  );
}

/** «Загрузка» (спецификация «Аналитика клуба», §6). Экран создаётся заново при смене компании (key). */
export function ClubLoadPage() {
  const { company } = useOutletContext<CompanyOutletContext>();
  return (
    <ClubReportScreen<LoadView>
      key={company.id}
      company={company}
      title={TITLE}
      subtitle="Загрузка ПК по часам, дням недели и зонам"
      help={HELP}
      report="load"
      byChoices={BY_CHOICES}
      byIn={CHART_ONLY}
      stepIn={CHART_ONLY}
      views={VIEWS}
      excel
    >
      {(ctx) => <LoadBody ctx={ctx} companyId={company.id} />}
    </ClubReportScreen>
  );
}
