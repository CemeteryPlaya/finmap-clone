import { formatMoney, MONEY_SCREEN_BEFORE } from '../../../shared/money';
import { compactMoney, donutArcs, sliceShare, type Slice } from '../../lib/charts';
import { bgOf, fillOf, type ChartPick } from './chart-kit';

const SIZE = 180;
const R = 86;
const R0 = 56;

/**
 * Кольцевая диаграмма группы за весь период (§4.2 спецификации «Аналитика»): части — строки разреза (не больше 8,
 * остальное — «Прочие»), в центре — сумма группы, легенда со суммами и долями. Между частями — зазор цвета карточки.
 * Рисунок — role="img" с итогом и частями в имени; та же информация видна в легенде. Нет положительных сумм — пустое
 * кольцо и «Нет сумм». С pick — части и строки легенды выбирают категорию (спецификация 2026-10-19, часть 3).
 */
export function DonutChart(props: { title: string; total: number; slices: readonly Slice[]; currency: string; pick?: ChartPick }) {
  const pick = props.pick;
  const money = (v: number) => formatMoney(v, props.currency, MONEY_SCREEN_BEFORE);
  const arcs = donutArcs(props.slices, SIZE / 2, SIZE / 2, R, R0);
  const parts = props.slices.map((s) => `${s.label} ${money(s.value)} (${sliceShare(s, props.slices)})`).join('; ');
  const label = `${props.title}: ${money(props.total)}${parts ? `. ${parts}` : '. Нет сумм'}`;
  return (
    <figure className="flex min-w-0 flex-col gap-3">
      <figcaption className="text-base font-bold text-ink">
        {props.title} <span className="font-semibold whitespace-nowrap tabular-nums">{money(props.total)}</span>
      </figcaption>
      <div className="flex flex-wrap items-center gap-6">
        <svg role="img" aria-label={label} width={SIZE} height={SIZE} viewBox={`0 0 ${SIZE} ${SIZE}`} className="shrink-0">
          {arcs.length === 0 ? (
            <circle cx={SIZE / 2} cy={SIZE / 2} r={(R + R0) / 2} fill="none" strokeWidth={R - R0} className="stroke-field" />
          ) : (
            // у единственной части зазора нет: полный круг из двух половин без шва
            // часть выбранной категории — щелчком мышью (решение 10); с клавиатуры — кнопки легенды
            arcs.map((a) => {
              const can = pick?.can(a.id) ?? false;
              return (
                <path
                  key={a.id}
                  data-slice={a.id}
                  d={a.d}
                  strokeWidth={arcs.length > 1 ? 2 : 0}
                  strokeLinejoin="round"
                  onClick={can ? () => pick!.onPick(a.id) : undefined}
                  className={`${fillOf(a.color)} stroke-card ${can ? 'cursor-pointer hover:opacity-80' : ''}`}
                />
              );
            })
          )}
          <text x={SIZE / 2} y={SIZE / 2} dy="0.35em" textAnchor="middle" className="fill-ink text-sm font-semibold">
            {arcs.length === 0 ? 'Нет сумм' : compactMoney(props.total, props.currency)}
          </text>
        </svg>
        {props.slices.length > 0 && (
          <ul aria-label={`Легенда: ${props.title}`} className="flex min-w-48 flex-1 flex-col gap-1.5 text-sm">
            {props.slices.map((s) => (
              <li key={s.id} className="flex items-center gap-2">
                <span aria-hidden="true" className={`size-3 shrink-0 rounded-sm ${bgOf(s.color)}`} />
                {pick?.can(s.id) ? (
                  <button
                    type="button"
                    aria-pressed={pick.selected === s.id}
                    aria-disabled={pick.busy || undefined}
                    title={s.label}
                    onClick={() => pick.onPick(s.id)}
                    className="min-w-0 flex-1 truncate rounded-md px-1 text-left text-ink hover:bg-field focus-visible:outline-2 focus-visible:outline-focus aria-pressed:bg-income-soft aria-pressed:font-semibold"
                  >
                    {s.label}
                  </button>
                ) : (
                  <span className="min-w-0 flex-1 truncate text-ink" title={s.label}>
                    {s.label}
                  </span>
                )}
                <span className="whitespace-nowrap tabular-nums text-ink">{money(s.value)}</span>
                <span className="w-16 text-right whitespace-nowrap tabular-nums text-muted">{sliceShare(s, props.slices)}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </figure>
  );
}
