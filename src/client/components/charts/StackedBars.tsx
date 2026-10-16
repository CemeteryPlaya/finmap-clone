import { formatMoney, MONEY_SCREEN_BEFORE } from '../../../shared/money';
import { compactMoney, labelEvery, niceScale, stackColumn, stackExtent, yOf, type StackSeries } from '../../lib/charts';
import { ChartColumns } from './ChartColumns';
import { bgOf, fillOf, PLOT, useWidth } from './chart-kit';

/**
 * Стек по колонкам шага (§4.2 спецификации «Аналитика»): «Поступления по категориям» и т. п. Части — ряды кольца, цвета
 * как в кольце; положительные значения — вверх от нуля, отрицательные — вниз. Колонки — кнопки поверх (подсказка с
 * частями колонки, выбор колонки), легенда под графиком.
 */
export function StackedBars(props: {
  title: string;
  columns: readonly { key: string; label: string }[];
  series: readonly StackSeries[];
  currency: string;
  selected: number | null;
  onSelect: (index: number) => void;
}) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const money = (v: number) => formatMoney(v, props.currency, MONEY_SCREEN_BEFORE);
  const n = props.columns.length;
  const plotW = Math.max(0, width - PLOT.left - PLOT.right);
  const plotH = PLOT.height - PLOT.top - PLOT.bottom;
  const scale = niceScale(stackExtent(props.series, n));
  const step = n > 0 ? plotW / n : 0;
  const barW = Math.max(1, Math.min(40, step * 0.6));
  const every = labelEvery(n, plotW);
  const y = (v: number) => PLOT.top + yOf(scale, v, plotH);
  const center = (i: number) => PLOT.left + (i + 0.5) * step;
  const parts = (i: number) => props.series.filter((s) => (s.values[i] ?? 0) !== 0);
  const summary = `${props.title}: ${props.series.map((s) => `${s.label} ${money(s.values.reduce((a, b) => a + b, 0))}`).join('; ') || 'нет сумм'}`;

  return (
    <figure className="min-w-0">
      <figcaption className="mb-2 text-base font-bold text-ink">{props.title}</figcaption>
      <div ref={ref} className="relative w-full" style={{ height: PLOT.height }}>
        {width > 0 && (
          <>
            <svg role="img" aria-label={summary} width={width} height={PLOT.height} className="block overflow-visible">
              {scale.ticks.map((t) => (
                <g key={t}>
                  <line x1={PLOT.left} x2={width - PLOT.right} y1={y(t)} y2={y(t)} className={t === 0 ? 'stroke-muted/60' : 'stroke-field'} strokeWidth={1} />
                  <text x={PLOT.left - 8} y={y(t)} dy="0.32em" textAnchor="end" className="fill-muted text-[11px]">
                    {compactMoney(t, props.currency)}
                  </text>
                </g>
              ))}
              {props.selected !== null && props.selected < n && <rect x={PLOT.left + props.selected * step} y={PLOT.top} width={step} height={plotH} className="fill-field" />}
              {props.columns.map((c, i) => (
                <g key={c.key}>
                  {stackColumn(props.series, i).map((seg) => {
                    const top = y(Math.max(seg.from, seg.to));
                    const bottom = y(Math.min(seg.from, seg.to));
                    // зазор цвета карточки между частями
                    return <rect key={seg.id} x={center(i) - barW / 2} y={top} width={barW} height={Math.max(0, bottom - top)} strokeWidth={1} className={`${fillOf(seg.color)} stroke-card`} />;
                  })}
                  {i % every === 0 && (
                    <text x={center(i)} y={PLOT.height - 8} textAnchor="middle" className="fill-muted text-[11px]">
                      {c.label}
                    </text>
                  )}
                </g>
              ))}
            </svg>
            <ChartColumns
              label={`${props.title}: колонки`}
              count={n}
              left={PLOT.left}
              top={PLOT.top}
              width={plotW}
              height={plotH}
              names={props.columns.map((c, i) => `${c.label}: ${parts(i).map((s) => `${s.label} ${money(s.values[i]!)}`).join(', ') || 'нет сумм'}`)}
              tip={(i) => ({
                title: props.columns[i]!.label,
                lines: parts(i).map((s) => ({ swatch: bgOf(s.color), label: s.label, value: money(s.values[i]!) })),
              })}
              selected={props.selected}
              onSelect={props.onSelect}
            />
          </>
        )}
      </div>
      {props.series.length > 0 && (
        <ul aria-label={`Легенда: ${props.title}`} className="mt-2 flex flex-wrap gap-x-5 gap-y-1 text-sm text-ink">
          {props.series.map((s) => (
            <li key={s.id} className="flex items-center gap-2">
              <span aria-hidden="true" className={`size-3 rounded-sm ${bgOf(s.color)}`} />
              {s.label}
            </li>
          ))}
        </ul>
      )}
    </figure>
  );
}
