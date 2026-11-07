import type { BarRow } from '../../shared/club-analytics/bar';
import type { ReportColumn, ReportStep } from '../../shared/report-engine';
import { formatQty } from '../../shared/stock-qty';
import type { ClubCoverage, ClubReportBase } from './club-analytics';
import type { OverviewTile } from './club-overview';
import { pluralRu } from './journal-format';

/** Строка товара или категории «Бара» (§8.1). */
export type BarRowView = BarRow;

/** Ответ `GET …/club-analytics/bar` (§8, §11). */
export interface BarView extends ClubReportBase {
  tiles: OverviewTile[];
  rows: BarRowView[];
  total: { soldQty: number; revenue: number; cost: number | null; profit: number | null; margin: number | null; writeOffQty: number };
  noCost: number;
  columns: ReportColumn[];
  series: { id: 'cost' | 'profit' | 'noCost'; label: string; values: (number | null)[] }[];
  purchases: { desk: number; restock: number; diff: number };
  coverage: ClubCoverage & { partial: number };
  prevCoverage: { days: number; withData: number } | null;
  freshness: string | null;
  meta: { from: string; to: string; step: ReportStep; by: 'items' | 'categories'; empty: boolean };
}

export type BarSortKey = keyof BarRowView;

const TEXT_KEYS: ReadonlySet<BarSortKey> = new Set(['key', 'category', 'abc']);

/** Сортировка таблицы по колонке: текст — `localeCompare('ru')`; пустые — в конце при любом направлении; равные — в исходном порядке. */
export function sortBar(rows: readonly BarRowView[], key: BarSortKey, dir: 'asc' | 'desc'): BarRowView[] {
  const sign = dir === 'asc' ? 1 : -1;
  return [...rows].sort((a, b) => {
    const [x, y] = [a[key], b[key]];
    if (x === null || y === null) return x === y ? 0 : x === null ? 1 : -1;
    return sign * (TEXT_KEYS.has(key) ? String(x).localeCompare(String(y), 'ru') : (x as number) - (y as number));
  });
}

/** «Хватит на», дней (R36): нет — «—»; до одного знака, целое — без запятой. */
export function daysLeftText(v: number | null): string {
  return v === null ? '—' : v.toLocaleString('ru-RU', { maximumFractionDigits: 1 });
}

/** Пометка под таблицей (§8.1): «без себестоимости: N товаров»; нет таких — null. */
export function noCostText(n: number): string | null {
  return n === 0 ? null : `без себестоимости: ${n} ${pluralRu(n, 'товар', 'товара', 'товаров')}`;
}

/** Количество Senet (×1000) — до 3 знаков без лишних нулей, как у склада. */
export function qtyText(qty: number): string {
  return formatQty(qty);
}
