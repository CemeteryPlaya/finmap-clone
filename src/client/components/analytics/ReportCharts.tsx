import type { ReportData } from '../../lib/analytics';
import { donutSlices, reportChart, stackSeries } from '../../lib/charts';
import { BY_LABELS } from '../../lib/report-url';
import { BarsLineChart, type BarsLineNames } from '../charts/BarsLineChart';
import { DonutChart } from '../charts/DonutChart';
import { StackedBars } from '../charts/StackedBars';

const sum = (xs: readonly number[]) => xs.reduce((s, x) => s + x, 0);

/**
 * Вид «график» отчёта (§4.2, §5.2 спецификации «Аналитика»): столбцы с линией по колонкам шага, два кольца за весь
 * период и два стека по колонкам — по строкам разреза групп. Щелчок по колонке любого графика выбирает её (повторный —
 * снимает выбор): под графиками — операции этой колонки. Пустой период — «Нет операций за период».
 */
export function ReportCharts(props: { title: string; data: ReportData; names: BarsLineNames; selected: string | null; onSelect: (key: string | null) => void; busy?: boolean }) {
  const { data } = props;
  if (data.meta.empty) {
    return <p className="rounded-xl bg-field px-4 py-10 text-center text-muted">Нет операций за период</p>;
  }
  const n = data.columns.length;
  const chart = reportChart(data.rows, n);
  const incomeSlices = donutSlices(chart.incomeRows);
  const expenseSlices = donutSlices(chart.expenseRows);
  const found = props.selected === null ? -1 : data.columns.findIndex((c) => c.key === props.selected);
  const selected = found < 0 ? null : found;
  const select = (i: number) => props.onSelect(i === selected ? null : data.columns[i]!.key);
  const by = BY_LABELS[data.meta.by].toLowerCase();
  const currency = data.meta.currency;
  return (
    <div className="flex flex-col gap-10">
      <BarsLineChart
        title={props.title}
        columns={data.columns}
        income={chart.income}
        expense={chart.expense}
        line={chart.line}
        names={props.names}
        currency={currency}
        selected={selected}
        onSelect={select}
        busy={props.busy}
      />
      <div className="grid gap-8 lg:grid-cols-2">
        <DonutChart title={props.names.income} total={sum(chart.income)} slices={incomeSlices} currency={currency} />
        <DonutChart title={props.names.expense} total={sum(chart.expense)} slices={expenseSlices} currency={currency} />
      </div>
      <StackedBars title={`${props.names.income} ${by}`} columns={data.columns} series={stackSeries(chart.incomeRows, incomeSlices, n)} currency={currency} selected={selected} onSelect={select} busy={props.busy} />
      <StackedBars title={`${props.names.expense} ${by}`} columns={data.columns} series={stackSeries(chart.expenseRows, expenseSlices, n)} currency={currency} selected={selected} onSelect={select} busy={props.busy} />
    </div>
  );
}
