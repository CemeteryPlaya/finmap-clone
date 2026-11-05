import { formatMoney, MONEY_SCREEN_BEFORE } from '../../../shared/money';
import { barSpan, compactMoney, gapPath, labelEvery, niceScale, yOf } from '../../lib/charts';
import { marginText } from '../../lib/stock-analytics';
import { ChartColumns, type TipLine } from './ChartColumns';
import { bgOf, PLOT, useWidth } from './chart-kit';

/** Цвета линий — палитра графиков; столбцы — цвет дохода. */
const STROKE = ['stroke-chart-1', 'stroke-chart-2', 'stroke-chart-3', 'stroke-chart-4', 'stroke-chart-5', 'stroke-chart-6', 'stroke-chart-7', 'stroke-chart-8'] as const;
const PERCENT_TICKS = [0, 0.25, 0.5, 0.75, 1];
/** Место справа под подписи оси процентов, когда слева — деньги. */
const RIGHT_AXIS = 44;

const percent = (v: number | null) => (v === null ? 'нет данных' : marginText(Math.round(v * 10_000)));

/**
 * Линии процентов по колонкам шага (спецификация «Аналитика клуба», §4, §6.3): загрузка 0–100 %; колонка без данных —
 * разрыв линии. С `bars` — столбцы денег (выручка «Обзора») по левой оси, проценты — по правой. Колонки — кнопки поверх
 * (подсказка со значениями); легенда снизу.
 */
export function PercentLinesChart(props: {
  title: string;
  columns: readonly { key: string; label: string }[];
  lines: readonly { id: string; label: string; values: readonly (number | null)[] }[];
  bars?: { label: string; values: readonly number[]; currency: string };
  busy?: boolean;
  /** Щелчок по колонке (у «Обзора» — «Выручка клуба» за день). */
  onSelect?: (index: number) => void;
}) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const n = props.columns.length;
  const right = props.bars ? RIGHT_AXIS : PLOT.right;
  const plotW = Math.max(0, width - PLOT.left - right);
  const plotH = PLOT.height - PLOT.top - PLOT.bottom;
  const step = n > 0 ? plotW / n : 0;
  const every = labelEvery(n, plotW);
  const center = (i: number) => PLOT.left + (i + 0.5) * step;
  const yPct = (v: number) => PLOT.top + (1 - Math.min(1, Math.max(0, v))) * plotH;
  const money = props.bars ? niceScale(props.bars.values) : null;
  const barW = Math.max(1, Math.min(28, step * 0.5));
  const moneyText = (v: number) => formatMoney(v, props.bars!.currency, MONEY_SCREEN_BEFORE);
  const tipLines = (i: number): TipLine[] => [
    ...(props.bars ? [{ swatch: 'bg-income', label: props.bars.label, value: moneyText(props.bars.values[i] ?? 0) }] : []),
    ...props.lines.map((l, k) => ({ swatch: bgOf(k), label: l.label, value: percent(l.values[i] ?? null) })),
  ];
  const summary = `${props.title}. ${props.lines.map((l) => l.label).join(', ')}${props.bars ? `; ${props.bars.label}` : ''}`;

  return (
    <figure className={`min-w-0 ${props.busy ? 'opacity-60' : ''}`}>
      <figcaption className="mb-2 text-base font-bold text-ink">{props.title}</figcaption>
      <div ref={ref} className="relative w-full" style={{ height: PLOT.height }}>
        {width > 0 && (
          <>
            <svg role="img" aria-label={summary} width={width} height={PLOT.height} className="block overflow-visible">
              {PERCENT_TICKS.map((t) => (
                <g key={t}>
                  <line x1={PLOT.left} x2={width - right} y1={yPct(t)} y2={yPct(t)} className={t === 0 ? 'stroke-muted/60' : 'stroke-field'} strokeWidth={1} />
                  <text x={props.bars ? width - right + 6 : PLOT.left - 8} y={yPct(t)} dy="0.32em" textAnchor={props.bars ? 'start' : 'end'} className="fill-muted text-[11px]">
                    {`${t * 100} %`}
                  </text>
                </g>
              ))}
              {money &&
                money.ticks.map((t) => (
                  <text key={t} x={PLOT.left - 8} y={PLOT.top + yOf(money, t, plotH)} dy="0.32em" textAnchor="end" className="fill-muted text-[11px]">
                    {compactMoney(t, props.bars!.currency)}
                  </text>
                ))}
              {props.columns.map((c, i) => {
                const bar = money ? barSpan(money, props.bars!.values[i] ?? 0, plotH) : null;
                return (
                  <g key={c.key}>
                    {bar && <rect x={center(i) - barW / 2} y={PLOT.top + bar.y} width={barW} height={bar.h} rx={Math.min(3, barW / 3)} className="fill-income/70" />}
                    {i % every === 0 && (
                      <text x={center(i)} y={PLOT.height - 8} textAnchor="middle" className="fill-muted text-[11px]">
                        {c.label}
                      </text>
                    )}
                  </g>
                );
              })}
              {props.lines.map((l, k) => (
                <g key={l.id}>
                  <path d={gapPath(l.values.map((v, i) => (v === null ? null : { x: center(i), y: yPct(v) })))} fill="none" strokeWidth={2} className={STROKE[k % STROKE.length]} />
                  {n <= 40 &&
                    l.values.map((v, i) => (v === null ? null : <circle key={i} cx={center(i)} cy={yPct(v)} r={3} strokeWidth={2} className={`fill-card ${STROKE[k % STROKE.length]}`} />))}
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
              names={props.columns.map((c, i) => `${c.label}: ${tipLines(i).map((t) => `${t.label} ${t.value}`).join(', ')}`)}
              tip={(i) => ({ title: props.columns[i]!.label, lines: tipLines(i) })}
              selected={null}
              onSelect={props.onSelect ?? (() => {})}
              busy={props.busy}
            />
          </>
        )}
      </div>
      <ul aria-label={`Легенда: ${props.title}`} className="mt-2 flex flex-wrap gap-x-5 gap-y-1 text-sm text-ink">
        {props.bars && (
          <li className="flex items-center gap-2">
            <span aria-hidden="true" className="size-3 rounded-sm bg-income/70" />
            {props.bars.label}
          </li>
        )}
        {props.lines.map((l, k) => (
          <li key={l.id} className="flex items-center gap-2">
            <span aria-hidden="true" className={`h-0.5 w-4 rounded-full ${bgOf(k)}`} />
            {l.label}
          </li>
        ))}
      </ul>
    </figure>
  );
}
