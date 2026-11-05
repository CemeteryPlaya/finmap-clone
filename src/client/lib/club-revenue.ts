import { useInfiniteQuery, type InfiniteData } from '@tanstack/react-query';
import { isValidDate } from '../../shared/dates';
import { formatMoney } from '../../shared/money';
import type { ReportColumn, ReportStep } from '../../shared/report-engine';
import { api, type ApiError } from './api';
import { coverageNote, type ClubCoverage, type ClubReportBase } from './club-analytics';

/** Строка ответа «Выручки клуба» (§5.1–§5.2). */
export interface RevenueRowView {
  id: string;
  label: string;
  kind: 'part' | 'info' | 'payment' | 'shift' | 'cashier';
  values: (number | null)[];
  total: number | null;
  prevTotal: number | null;
  /** Смена: день открытия — ссылка на неё в «Сверке». */
  day?: string;
}

/** Ответ `GET …/club-analytics/revenue` (§11). */
export interface RevenueView extends ClubReportBase {
  columns: ReportColumn[];
  rows: RevenueRowView[];
  heatmap?: (number | null)[][];
  coverage: ClubCoverage & { partial: number; columns: { withData: number; total: number }[] };
  prevCoverage: { days: number; withData: number } | null;
  reconcile: { shifts: number; desk: number; revenue: number; diffShifts: { id: number; openedAt: string; diff: number }[] };
  freshness: string | null;
  meta: { from: string; to: string; step: ReportStep; by: string; empty: boolean };
}

/** Деньги Senet — в целых тенге (§2.3): «6 000 ₸»; средние карты часов округляются, половина — от нуля. */
export const clubMoney = (v: number) => formatMoney(Math.sign(v) * Math.round(Math.abs(v) / 100) * 100, 'KZT', { trimZeroMinor: true });

/** Заголовок списка под ячейкой (§2.2): «Бар за 1 ноя» или «Бар за период». */
export function revenueCellTitle(row: { label: string }, col: ReportColumn | null): string {
  return `${row.label} за ${col ? col.label : 'период'}`;
}

/** Ступени карты часов (§5.3): от пустой к самой насыщенной. */
const HEAT_STEPS = ['bg-field', 'bg-income/15', 'bg-income/30', 'bg-income/50', 'bg-income/70', 'bg-income'] as const;
/** Час без данных — серая штриховка. */
export const HEAT_NONE = 'bg-[repeating-linear-gradient(45deg,var(--color-field)_0_4px,transparent_4px_8px)]';

/** Цвет ячейки карты часов: 6 ступеней от `bg-field` к `bg-income`; null — штриховка «нет данных». */
export function heatColor(value: number | null, max: number): string {
  if (value === null) return HEAT_NONE;
  if (max <= 0 || value <= 0) return HEAT_STEPS[0];
  return HEAT_STEPS[Math.min(5, Math.ceil((value / max) * 5))]!;
}

export const WEEKDAYS = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'] as const;
const hh = (h: number) => `${String(h).padStart(2, '0')}:00`;

/** Подпись ячейки карты для программ чтения: «Пн, 20:00–21:00: 6 000 ₸». */
export function heatLabel(weekday: number, hour: number, value: number | null): string {
  return `${WEEKDAYS[weekday]}, ${hh(hour)}–${hh(hour + 1)}: ${value === null ? 'нет данных' : clubMoney(value)}`;
}

/** Ячейка с числом, а не деньгами: колонка «Смен» разреза «По кассирам» (§5.2); итог (index −1) — всегда деньги. */
export function countCell(by: string, index: number): boolean {
  return by === 'cashiers' && index === 1;
}

/** Подпись колонки с днями без данных (§3.3). */
export function missingText(withData: number, total: number): string | null {
  return withData < total ? `данные не за все дни (${withData} из ${total})` : null;
}

/** Строки, у ячеек которых есть список строк Senet (`revenue/rows`); разница — вычисление, у неё списка нет. */
const CELL_ROWS = ['packages', 'rent', 'hours', 'bar', 'revenue', 'refills', 'desk'] as const;
export type RevenueCellRow = (typeof CELL_ROWS)[number];

export function revenueCellRow(rowId: string): RevenueCellRow | null {
  return (CELL_ROWS as readonly string[]).includes(rowId) ? (rowId as RevenueCellRow) : null;
}

/** Δ сумм с «≈» (§2.2): в текущем периоде есть прошедшие дни без данных или прошлый период неполон. */
export function revenueApprox(data: { coverage: ClubCoverage; prevCoverage: RevenueView['prevCoverage'] }, today: string): boolean {
  const prev = data.prevCoverage;
  return coverageNote(data.coverage, today) !== null || (prev !== null && prev.withData < prev.days);
}

/** Ряды графика (§5): столбцы «Часы» и «Бар», линия «Деньги в кассу»; колонка без данных — 0. */
export function chartSeries(rows: readonly { id: string; values: readonly (number | null)[] }[]) {
  const of = (id: string) => (rows.find((r) => r.id === id)?.values ?? []).map((v) => v ?? 0);
  return { income: of('hours'), expense: of('bar'), line: of('desk') };
}

/** «Не сходится со сменами: X ₸» (§3.4): сумма расхождений смен. */
export function reconcileTotal(shifts: readonly { diff: number }[]): number {
  return shifts.reduce((t, s) => t + s.diff, 0);
}

/** Ссылка на смену в «Сверке»: список за день её открытия, смена раскрыта. */
export function shiftHref(companyId: number, shiftId: number, day: string): string {
  return `/c/${companyId}/senet/shifts?shift=${shiftId}&day=${day}`;
}

/** Смена из адреса «Сверки» (ссылка из «Выручки клуба»); неверная — null. */
export function shiftLink(params: URLSearchParams): { shift: number; day: string } | null {
  const shift = params.get('shift') ?? '';
  const day = params.get('day');
  if (!/^\d{1,15}$/.test(shift) || day === null || !isValidDate(day)) return null;
  return { shift: Number(shift), day };
}

/** Строка Senet под ячейкой (§2.2). */
export interface CellItemView {
  at: string;
  kind: 'session' | 'package' | 'sale' | 'refill' | 'transaction';
  label: string;
  amount: number;
  workstation: number | null;
  guest: string;
  phoneMask: string | null;
}

interface CellPage {
  items: CellItemView[];
  nextCursor: string | null;
}

/** Строки Senet ячейки: страницы по 50 (`cursor` — смещение). params — параметры отчёта, row и col. */
export function useRevenueCellRows(companyId: number, params: string) {
  return useInfiniteQuery<CellPage, ApiError, InfiniteData<CellPage, string>, readonly unknown[], string>({
    queryKey: ['analytics', companyId, 'club', 'revenue-rows', params],
    initialPageParam: '0',
    queryFn: ({ pageParam }) => api<CellPage>(`/companies/${companyId}/club-analytics/revenue/rows?${params}&cursor=${pageParam}`),
    getNextPageParam: (last) => last.nextCursor ?? undefined,
  });
}
