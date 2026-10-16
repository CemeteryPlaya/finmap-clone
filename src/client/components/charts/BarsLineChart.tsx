import { formatMoney, MONEY_SCREEN_BEFORE } from '../../../shared/money';
import { barSpan, compactMoney, labelEvery, linePath, niceScale, yOf } from '../../lib/charts';
import { ChartColumns } from './ChartColumns';
import { PLOT, useWidth } from './chart-kit';

export interface BarsLineNames {
  income: string;
  expense: string;
  line: string;
}

const sum = (xs: readonly number[]) => xs.reduce((s, x) => s + x, 0);

/**
 * Комбинированный график (§4.2, §5.2 спецификации «Аналитика»): по колонкам шага столбцы дохода (зелёные) и расхода
 * (тёмные), линия разницы («Сальдо» или «Прибыль», не накопительно); ось Y с нулём и отрицательными значениями. Рисунок —
 * SVG с role="img" и кратким итогом в имени; колонки — кнопки поверх (ChartColumns): подсказка и выбор колонки.
 * Легенда — под графиком. Полная таблица чисел — вид «таблица».
 */
export function BarsLineChart(props: {
  title: string;
  columns: readonly { key: string; label: string }[];
  income: readonly number[];
  expense: readonly number[];
  line: readonly number[];
  names: BarsLineNames;
  currency: string;
  selected: number | null;
  onSelect: (index: number) => void;
  busy?: boolean;
}) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const money = (v: number) => formatMoney(v, props.currency, MONEY_SCREEN_BEFORE);
  const n = props.columns.length;
  const plotW = Math.max(0, width - PLOT.left - PLOT.right);
  const plotH = PLOT.height - PLOT.top - PLOT.bottom;
  const scale = niceScale([...props.income, ...props.expense, ...props.line]);
  const step = n > 0 ? plotW / n : 0;
  const barW = Math.max(1, Math.min(24, step * 0.32));
  const every = labelEvery(n, plotW);
  const y = (v: number) => PLOT.top + yOf(scale, v, plotH);
  const center = (i: number) => PLOT.left + (i + 0.5) * step;
  const summary = `${props.title}. ${props.names.income}: ${money(sum(props.income))}; ${props.names.expense}: ${money(sum(props.expense))}; ${props.names.line}: ${money(sum(props.line))}`;

  return (
    <figure className="min-w-0">
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
              {props.columns.map((c, i) => {
                const inc = barSpan(scale, props.income[i] ?? 0, plotH);
                const exp = barSpan(scale, props.expense[i] ?? 0, plotH);
                return (
                  <g key={c.key}>
                    <rect x={center(i) - barW - 1} y={PLOT.top + inc.y} width={barW} height={inc.h} rx={Math.min(3, barW / 3)} className="fill-income" />
                    <rect x={center(i) + 1} y={PLOT.top + exp.y} width={barW} height={exp.h} rx={Math.min(3, barW / 3)} className="fill-chart-expense" />
                    {i % every === 0 && (
                      <text x={center(i)} y={PLOT.height - 8} textAnchor="middle" className="fill-muted text-[11px]">
                        {c.label}
                      </text>
                    )}
                  </g>
                );
              })}
              <path d={linePath(props.line.map((v, i) => ({ x: center(i), y: y(v) })))} fill="none" strokeWidth={2} className="stroke-chart-line" />
              {props.line.map((v, i) => (
                <circle key={i} cx={center(i)} cy={y(v)} r={n > 40 ? 2 : 4} strokeWidth={2} className="fill-chart-line stroke-card" />
              ))}
            </svg>
            <ChartColumns
              label={`${props.title}: колонки`}
              count={n}
              left={PLOT.left}
              top={PLOT.top}
              width={plotW}
              height={plotH}
              names={props.columns.map(
                (c, i) =>
                  `${c.label}: ${props.names.income} ${money(props.income[i] ?? 0)}, ${props.names.expense} ${money(props.expense[i] ?? 0)}, ${props.names.line} ${money(props.line[i] ?? 0)}`,
              )}
              tip={(i) => ({
                title: props.columns[i]!.label,
                lines: [
                  { swatch: 'bg-income', label: props.names.income, value: money(props.income[i] ?? 0) },
                  { swatch: 'bg-chart-expense', label: props.names.expense, value: money(props.expense[i] ?? 0) },
                  { swatch: 'bg-chart-line', label: props.names.line, value: money(props.line[i] ?? 0) },
                ],
              })}
              selected={props.selected}
              onSelect={props.onSelect}
              busy={props.busy}
            />
          </>
        )}
      </div>
      <figcaption>
        <ul aria-label={`Легенда: ${props.title}`} className="mt-2 flex flex-wrap gap-x-5 gap-y-1 text-sm text-ink">
          <li className="flex items-center gap-2">
            <span aria-hidden="true" className="size-3 rounded-sm bg-income" />
            {props.names.income}
          </li>
          <li className="flex items-center gap-2">
            <span aria-hidden="true" className="size-3 rounded-sm bg-chart-expense" />
            {props.names.expense}
          </li>
          <li className="flex items-center gap-2">
            <span aria-hidden="true" className="h-0.5 w-4 rounded-full bg-chart-line" />
            {props.names.line}
          </li>
        </ul>
      </figcaption>
    </figure>
  );
}
