import { matchesQuery } from '../../shared/search';
import { formatQty, UNIT_LABELS, type StockUnit } from '../../shared/stock-qty';
import type { PricePoint } from '../../shared/stock-price';
import type { BalanceItem, StockGroup, StockItem, StockWarehouse } from './stock';

/** Подвкладки экрана «Склад» (§4 спецификации «Склад»); «Аналитика» — план «Склад-3». */
export const STOCK_TABS = [
  { path: 'balance', label: 'Остатки' },
  { path: 'docs', label: 'Документы' },
  { path: 'items', label: 'Товары' },
  { path: 'analytics', label: 'Аналитика' },
] as const;
export type StockTabPath = (typeof STOCK_TABS)[number]['path'];

/** Подвкладка по умолчанию, куда ведёт адрес `…/stock`. */
export const DEFAULT_STOCK_TAB: StockTabPath = 'balance';

/** Склад из `?warehouse=`: существующий (неархивный или архивный) склад компании; иначе null — склад не выбран в адресе. */
export function warehouseParam(search: URLSearchParams, warehouses: readonly Pick<StockWarehouse, 'id'>[] | undefined): number | null {
  const raw = search.get('warehouse');
  if (raw === null || !/^\d+$/.test(raw)) return null;
  const id = Number(raw);
  return warehouses?.some((w) => w.id === id) ? id : null;
}

/** Склад экрана «Склад»: из адреса, иначе первый неархивный, иначе первый; null — складов нет. */
export function effectiveWarehouse(fromUrl: number | null, warehouses: readonly Pick<StockWarehouse, 'id' | 'archivedAt'>[]): number | null {
  return fromUrl ?? (warehouses.find((w) => !w.archivedAt) ?? warehouses[0])?.id ?? null;
}

/** Адрес подвкладки с отбором склада: `/c/1/stock/balance?warehouse=3`. */
export function stockHref(companyId: number, tab: string, warehouse: number | null): string {
  return `/c/${companyId}/stock/${tab}${warehouse === null ? '' : `?warehouse=${warehouse}`}`;
}

/** Название склада для проекта, у которого его ещё нет (§4.5: «Бар {проект}»). */
export function defaultWarehouseName(projectName: string): string {
  return `Бар ${projectName}`;
}

/** Товары, подходящие под запрос: по названию, штрихкоду и названию группы (без учёта регистра и «ё»). */
export function filterItems(items: readonly StockItem[], groups: readonly StockGroup[], query: string): StockItem[] {
  const q = query.trim();
  if (q === '') return [...items];
  const groupName = new Map(groups.map((g) => [g.id, g.name]));
  return items.filter((i) => matchesQuery(`${i.name} ${i.barcode ?? ''} ${i.groupId === null ? '' : (groupName.get(i.groupId) ?? '')}`, q));
}

export interface ItemSection {
  key: string;
  title: string;
  items: StockItem[];
}

/** Товары по группам: группы в порядке справочника, затем «Без группы»; архивные товары — в конце своей группы. Пустые группы не показываются. */
export function itemSections(items: readonly StockItem[], groups: readonly StockGroup[]): ItemSection[] {
  const ordered = (list: readonly StockItem[]) => [...list.filter((i) => !i.archivedAt), ...list.filter((i) => i.archivedAt)];
  const known = new Set(groups.map((g) => g.id));
  const sections: ItemSection[] = groups.map((g) => ({ key: String(g.id), title: g.name, items: ordered(items.filter((i) => i.groupId === g.id)) }));
  sections.push({ key: 'none', title: 'Без группы', items: ordered(items.filter((i) => i.groupId === null || !known.has(i.groupId))) });
  return sections.filter((s) => s.items.length > 0);
}

/** История цены продажи для окна «Цена продажи»: новые сверху. */
export function priceHistoryRows(prices: readonly PricePoint[]): PricePoint[] {
  return [...prices].sort((a, b) => (a.validFrom < b.validFrom ? 1 : a.validFrom > b.validFrom ? -1 : 0));
}

/** Проекты, у которых ещё нет склада (неархивные), — строки «Создать склад» в настройках. */
export function projectsWithoutWarehouse<P extends { id: number; archivedAt: string | null }>(projects: readonly P[], warehouses: readonly Pick<StockWarehouse, 'projectId'>[]): P[] {
  const taken = new Set(warehouses.map((w) => w.projectId));
  return projects.filter((p) => !p.archivedAt && !taken.has(p.id));
}

/** «234,3 %», «\u221212 %», «0 %»; null — закупка неизвестна или равна нулю: «—». */
export function markupText(bp: number | null): string {
  if (bp === null) return '—';
  const percent = Math.abs(bp) / 100;
  const text = (Math.round(percent * 10) / 10).toString().replace('.', ',');
  if (bp === 0 || text === '0') return '0 %';
  return `${bp < 0 ? '\u2212' : '+'}${text} %`;
}

/** «8 шт», «1,5 л». */
export function qtyWithUnit(qty: number, unit: StockUnit): string {
  return `${formatQty(qty)} ${UNIT_LABELS[unit]}`;
}

export interface BalanceRow {
  item: StockItem;
  balance: BalanceItem;
}

export interface BalanceSection {
  key: string;
  title: string;
  rows: BalanceRow[];
}

/**
 * Строки «Остатков» по группам (как «Товары»). Товары без остатка, долга и предупреждений скрыты, пока не включено
 * «Показывать товары без остатка»; поиск — по названию, штрихкоду и группе.
 */
export function balanceSections(
  balance: readonly BalanceItem[],
  items: readonly StockItem[],
  groups: readonly StockGroup[],
  opts: { showEmpty: boolean; query: string },
): BalanceSection[] {
  const byId = new Map(balance.map((b) => [b.itemId, b]));
  const visible = filterItems(items, groups, opts.query).filter((i) => {
    const b = byId.get(i.id);
    if (!b) return false;
    return opts.showEmpty || b.qty !== 0 || b.deficit > 0 || b.low || b.cost !== 0;
  });
  return itemSections(visible, groups).map((s) => ({ ...s, rows: s.items.map((item) => ({ item, balance: byId.get(item.id)! })) }));
}
