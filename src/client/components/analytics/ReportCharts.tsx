import type { ReportData } from '../../lib/analytics';
import { donutSlices, reportChart, stackSeries } from '../../lib/charts';
import { focusChart, rowCategoryId, type CategoryFocusProps } from '../../lib/report-focus';
import { BY_LABELS } from '../../lib/report-url';
import { BarsLineChart, type BarsLineNames } from '../charts/BarsLineChart';
import type { ChartPick } from '../charts/chart-kit';
import { DonutChart } from '../charts/DonutChart';
import { StackedBars } from '../charts/StackedBars';

const sum = (xs: readonly number[]) => xs.reduce((s, x) => s + x, 0);

/**
 * Вид «график» отчёта (§4.2, §5.2 спецификации «Аналитика»): столбцы с линией по колонкам шага, два кольца за весь
 * период и два стека по колонкам — по строкам разреза групп. Щелчок по колонке любого графика выбирает её (повторный —
 * снимает выбор): под графиками — операции этой колонки. С focus — часть кольца, сегмент стека и строка легенды выбирают
 * категорию; при выбранной категории с подкатегориями кольцо и стек её группы — по подкатегориям (план 2026-10-20,
 * решения 10–11). Пустой период — «Нет операций за период».
 */
export function ReportCharts(props: {
  title: string;
  data: ReportData;
  names: BarsLineNames;
  selected: string | null;
  onSelect: (key: string | null) => void;
  busy?: boolean;
  focus?: CategoryFocusProps;
}) {
  const { data, focus } = props;
  if (data.meta.empty) {
    return <p className="rounded-xl bg-field px-4 py-10 text-center text-muted">Нет операций за период</p>;
  }
  const n = data.columns.length;
  const chart = focusChart(reportChart(data.rows, n), focus?.selected ?? null);
  const incomeSlices = donutSlices(chart.incomeRows);
  const expenseSlices = donutSlices(chart.expenseRows);
  const found = props.selected === null ? -1 : data.columns.findIndex((c) => c.key === props.selected);
  const selected = found < 0 ? null : found;
  const select = (i: number) => props.onSelect(i === selected ? null : data.columns[i]!.key);
  const by = BY_LABELS[data.meta.by].toLowerCase();
  const currency = data.meta.currency;
  const pick: ChartPick | undefined = focus && {
    selected: [...chart.incomeRows, ...chart.expenseRows].find((r) => focus.selected !== null && rowCategoryId(r.id) === focus.selected)?.id ?? null,
    can: (id) => focus.canSelect(id),
    // пока показан прежний отчёт, кнопки остаются (фокус не теряется), но не действуют — как колонки и ячейки (R8)
    busy: props.busy,
    onPick: (id) => {
      const categoryId = rowCategoryId(id);
      if (!props.busy && categoryId !== null) focus.onSelect(categoryId);
    },
  };
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
        <DonutChart title={props.names.income} total={sum(chart.income)} slices={incomeSlices} currency={currency} pick={pick} />
        <DonutChart title={props.names.expense} total={sum(chart.expense)} slices={expenseSlices} currency={currency} pick={pick} />
      </div>
      <StackedBars
        title={`${props.names.income} ${by}`}
        columns={data.columns}
        series={stackSeries(chart.incomeRows, incomeSlices, n)}
        currency={currency}
        selected={selected}
        onSelect={select}
        busy={props.busy}
        pick={pick}
      />
      <StackedBars
        title={`${props.names.expense} ${by}`}
        columns={data.columns}
        series={stackSeries(chart.expenseRows, expenseSlices, n)}
        currency={currency}
        selected={selected}
        onSelect={select}
        busy={props.busy}
        pick={pick}
      />
    </div>
  );
}
