import { getCurrency } from '../../shared/currencies';
import { sharePercent, type ReportRow } from '../../shared/report-engine';

/**
 * Расчёты графиков «Аналитики» (§4.2 спецификации «Аналитика»): шкала оси, подписи, столбцы, кольца, стеки. Чистые функции
 * без DOM — компоненты `components/charts/*` только рисуют. Суммы — в минимальных единицах базовой валюты.
 */

/** Шкала оси Y: «круглые» деления; ноль всегда на оси — отрицательные значения уходят вниз от него. */
export interface Scale {
  min: number;
  max: number;
  ticks: number[];
}

const NICE = [1, 2, 2.5, 5, 10];

/**
 * Шкала по значениям (§4.2: «Ось Y с отрицательными значениями»): границы — кратные шагу 1, 2, 2,5 или 5 × 10ⁿ, около
 * count делений. Все значения нулевые (или их нет) — ось только с нулём, столбцы нулевой высоты.
 */
export function niceScale(values: readonly number[], count = 4): Scale {
  const lo = Math.min(0, ...values);
  const hi = Math.max(0, ...values);
  if (lo === hi) return { min: 0, max: 1, ticks: [0] };
  const raw = (hi - lo) / count;
  const mag = 10 ** Math.floor(Math.log10(raw));
  let step = NICE.find((k) => k * mag >= raw)! * mag;
  // шаг — целое число минимальных единиц (2,5 тиына не бывает)
  if (step < 1 || !Number.isInteger(step)) step = Math.max(1, Math.ceil(step));
  const min = Math.floor(lo / step) * step;
  const max = Math.ceil(hi / step) * step;
  const ticks: number[] = [];
  for (let v = min; v <= max; v += step) ticks.push(v);
  return { min, max, ticks };
}

/** Координата значения на высоте height (0 — верх области), по шкале. */
export function yOf(scale: Scale, value: number, height: number): number {
  return ((scale.max - value) / (scale.max - scale.min)) * height;
}

/** Прямоугольник столбца от нуля до значения: y — верх, h — высота (вниз для отрицательных). */
export function barSpan(scale: Scale, value: number, height: number): { y: number; h: number } {
  const zero = yOf(scale, 0, height);
  const at = yOf(scale, value, height);
  return { y: Math.min(zero, at), h: Math.abs(zero - at) };
}

const trim = (n: number) => n.toFixed(1).replace(/\.0$/, '').replace('.', ',');

/** Подпись деления оси: «12 млн», «1,5 млн», «500 тыс», «750»; минус — U+2212. Без символа валюты (он в заголовке). */
export function compactMoney(minor: number, currency: string): string {
  const major = minor / 10 ** getCurrency(currency).minorUnits;
  const abs = Math.abs(major);
  const sign = major < 0 ? '\u2212' : '';
  if (abs >= 1e9) return `${sign}${trim(abs / 1e9)}\u00A0млрд`;
  if (abs >= 1e6) return `${sign}${trim(abs / 1e6)}\u00A0млн`;
  if (abs >= 1e3) return `${sign}${trim(abs / 1e3)}\u00A0тыс`;
  return `${sign}${Math.round(abs)}`;
}

/** Каждая какая по счёту подпись колонки видна: не теснее minWidth пикселей на подпись (92 дня на телефоне — каждая 15-я). */
export function labelEvery(columns: number, width: number, minWidth = 56): number {
  if (columns <= 0 || width <= 0) return 1;
  return Math.max(1, Math.ceil((columns * minWidth) / width));
}

/** Ломаная через точки: «M x y L x y …»; без точек — пусто. */
export function linePath(points: readonly { x: number; y: number }[]): string {
  return points.map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x.toFixed(1)} ${p.y.toFixed(1)}`).join(' ');
}

/** Цвет части: номер в палитре (0–7) или «Прочие». */
export type SliceColor = number | 'other';

export interface Slice {
  id: string;
  label: string;
  value: number;
  color: SliceColor;
}

export const OTHER_ID = 'other';
export const OTHER_LABEL = 'Прочие';
/** Частей кольца не больше 8 (§4.2): девятая и дальше складываются в «Прочие». */
export const MAX_SLICES = 8;

/** Цветов в палитре графиков (chart-1…8). */
export const PALETTE_SIZE = 8;

/** Предпочтительный цвет строки по её месту среди всех строк разреза группы в отчёте (с нуля). */
export const rowColor = (index: number): SliceColor => index % PALETTE_SIZE;

/**
 * Цвета показанных частей без повторов: каждая часть по порядку отчёта берёт предпочтительный цвет (rowColor), а если его
 * уже занял предыдущий показанный, — ближайший свободный дальше по кругу палитры. Показанных не больше PALETTE_SIZE
 * (с «Прочими» — не больше MAX_SLICES), поэтому свободный цвет всегда есть. Присвоение зависит только от состава показанных
 * частей и порядка отчёта, поэтому одно и то же в кольце и в стеке.
 */
function uniqueColors(orders: readonly number[]): number[] {
  const used = new Set<number>();
  return orders.map((order) => {
    let color = order % PALETTE_SIZE;
    while (used.has(color)) color = (color + 1) % PALETTE_SIZE;
    used.add(color);
    return color;
  });
}

/**
 * Части кольца по строкам разреза за весь период (§4.2): только положительные итоги (кольцо не рисует минус). Больше
 * MAX_SLICES частей — семь крупнейших и «Прочие». Цвет — по месту строки среди всех строк разреза в отчёте (rowColor), а не
 * по размеру: смена периода (нулевая строка выше, другой состав семёрки) не перекрашивает соседей. Если строки на местах k
 * и k + 8 показаны вместе, вторая берёт следующий свободный цвет (uniqueColors): у показанных частей цвета всегда разные.
 */
export function donutSlices(rows: readonly Pick<ReportRow, 'id' | 'label' | 'total'>[], limit = MAX_SLICES): Slice[] {
  // больше MAX_SLICES частей палитра не вместит: цвета не повторялись бы, а подбор свободного не кончался бы
  const max = Math.min(limit, MAX_SLICES);
  const positive = rows
    .map((r, order) => ({ id: r.id, label: r.label, value: r.total ?? 0, order }))
    .filter((p) => p.value > 0);
  const kept = positive.length <= max ? positive : (() => {
    const ids = new Set([...positive].sort((a, b) => b.value - a.value || a.order - b.order).slice(0, max - 1).map((p) => p.id));
    return positive.filter((p) => ids.has(p.id));
  })();
  const colors = uniqueColors(kept.map((p) => p.order));
  const shown: Slice[] = kept.map((p, i) => ({ id: p.id, label: p.label, value: p.value, color: colors[i]! }));
  if (kept.length === positive.length) return shown;
  const own = new Set(kept.map((p) => p.id));
  const rest = positive.filter((p) => !own.has(p.id)).reduce((s, p) => s + p.value, 0);
  return [...shown, { id: OTHER_ID, label: OTHER_LABEL, value: rest, color: 'other' }];
}

/** Доля части в сумме частей кольца: «12,50 %». */
export function sliceShare(slice: Slice, slices: readonly Slice[]): string {
  return sharePercent(slice.value, slices.reduce((s, x) => s + x.value, 0)) ?? '';
}

/** Ряд стека: значения по колонкам. Части «Прочие» — сумма строк, не вошедших в кольцо. */
export interface StackSeries {
  id: string;
  label: string;
  color: SliceColor;
  values: number[];
}

/**
 * Ряды стека по частям кольца (§4.2: «цвета частей как в кольцах»): у каждой части — значения её строки по колонкам,
 * у «Прочих» — сумма остальных строк (включая строки с итогом не больше нуля).
 */
export function stackSeries(rows: readonly Pick<ReportRow, 'id' | 'label' | 'values'>[], slices: readonly Slice[], columns: number): StackSeries[] {
  const own = new Set(slices.map((s) => s.id));
  return slices.map((s) => {
    if (s.id !== OTHER_ID) {
      const row = rows.find((r) => r.id === s.id)!;
      return { id: s.id, label: s.label, color: s.color, values: Array.from({ length: columns }, (_, i) => row.values[i] ?? 0) };
    }
    const values = new Array<number>(columns).fill(0);
    for (const r of rows) if (!own.has(r.id)) r.values.forEach((v, i) => (values[i]! += v ?? 0));
    return { id: s.id, label: s.label, color: s.color, values };
  });
}

/** Отрезок ряда в колонке стека: от from до to в единицах суммы. */
export interface Segment {
  id: string;
  color: SliceColor;
  from: number;
  to: number;
}

/** Стек колонки: положительные значения — вверх от нуля, отрицательные — вниз, по порядку рядов; нули пропускаются. */
export function stackColumn(series: readonly StackSeries[], column: number): Segment[] {
  let up = 0;
  let down = 0;
  const out: Segment[] = [];
  for (const s of series) {
    const v = s.values[column] ?? 0;
    if (v > 0) {
      out.push({ id: s.id, color: s.color, from: up, to: up + v });
      up += v;
    } else if (v < 0) {
      out.push({ id: s.id, color: s.color, from: down, to: down + v });
      down += v;
    }
  }
  return out;
}

/** Высота и глубина стеков по всем колонкам — для шкалы. */
export function stackExtent(series: readonly StackSeries[], columns: number): number[] {
  const out: number[] = [];
  for (let i = 0; i < columns; i++) {
    const seg = stackColumn(series, i);
    out.push(Math.max(0, ...seg.map((s) => s.to)), Math.min(0, ...seg.map((s) => s.to)));
  }
  return out;
}

/** Точка окружности: угол от 12 часов по часовой стрелке. */
const point = (cx: number, cy: number, r: number, a: number) => [cx + r * Math.sin(a), cy - r * Math.cos(a)] as const;

/**
 * Сектор кольца от угла a0 до a1 (радианы от 12 часов по часовой): внешняя дуга r, внутренняя r0. Полный круг (одна часть —
 * 100 %) рисуется двумя половинами: дуга с совпадающими концами в SVG не рисуется.
 */
export function arcPath(cx: number, cy: number, r: number, r0: number, a0: number, a1: number): string {
  if (a1 - a0 >= Math.PI * 2 - 1e-9) {
    const mid = a0 + Math.PI;
    return `${arcPath(cx, cy, r, r0, a0, mid)} ${arcPath(cx, cy, r, r0, mid, a0 + Math.PI * 2)}`;
  }
  const large = a1 - a0 > Math.PI ? 1 : 0;
  const [x0, y0] = point(cx, cy, r, a0);
  const [x1, y1] = point(cx, cy, r, a1);
  const [x2, y2] = point(cx, cy, r0, a1);
  const [x3, y3] = point(cx, cy, r0, a0);
  // -0.00 не пишется: у точек на осях координата ровно ноль
  const f = (n: number) => (Math.abs(n) < 0.005 ? 0 : n).toFixed(2);
  return `M${f(x0)} ${f(y0)} A${r} ${r} 0 ${large} 1 ${f(x1)} ${f(y1)} L${f(x2)} ${f(y2)} A${r0} ${r0} 0 ${large} 0 ${f(x3)} ${f(y3)} Z`;
}

/** Секторы кольца по частям: углы пропорциональны значениям, по порядку частей от 12 часов. */
export function donutArcs(slices: readonly Slice[], cx: number, cy: number, r: number, r0: number): { id: string; color: SliceColor; d: string }[] {
  const sum = slices.reduce((s, x) => s + x.value, 0);
  if (sum <= 0) return [];
  let a = 0;
  return slices.map((s) => {
    const a1 = a + (s.value / sum) * Math.PI * 2;
    const d = arcPath(cx, cy, r, r0, a, a1);
    a = a1;
    return { id: s.id, color: s.color, d };
  });
}

/** Данные графиков отчёта (§4.2, §5.2): столбцы групп по колонкам, линия — их разница, строки разреза групп для колец и стеков. */
export interface ReportChartData {
  income: number[];
  expense: number[];
  /** «Сальдо» у «Денег», «Прибыль» у «Прибыли»: доход - расход колонки, не накопительно. */
  line: number[];
  incomeRows: ReportRow[];
  expenseRows: ReportRow[];
}

/** Из ответа отчёта: группы «income» и «expense» (у «Прибыли» со строками склада в «Расходах»). */
export function reportChart(rows: readonly ReportRow[], columns: number): ReportChartData {
  const group = (id: string) => rows.find((r) => r.id === id);
  const values = (row: ReportRow | undefined) => Array.from({ length: columns }, (_, i) => (row?.values[i] as number | null | undefined) ?? 0);
  const income = values(group('income'));
  const expense = values(group('expense'));
  return {
    income,
    expense,
    line: income.map((v, i) => v - expense[i]!),
    incomeRows: group('income')?.children ?? [],
    expenseRows: group('expense')?.children ?? [],
  };
}
