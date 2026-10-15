import { describe, expect, it } from 'vitest';
import type { BalanceItem, StockGroup, StockItem } from '../../src/client/lib/stock';
import {
  balanceSections,
  defaultWarehouseName,
  filterItems,
  itemSections,
  markupText,
  priceHistoryRows,
  projectsWithoutWarehouse,
  qtyWithUnit,
  stockHref,
  warehouseParam,
} from '../../src/client/lib/stock-view';

const group = (id: number, name: string): StockGroup => ({ id, companyId: 1, name, orderIndex: id, createdAt: 'x', archivedAt: null });
const item = (id: number, name: string, over: Partial<StockItem> = {}): StockItem => ({
  id,
  companyId: 1,
  name,
  groupId: null,
  unit: 'pcs',
  barcode: null,
  isCombo: false,
  salePrice: 0,
  minQty: null,
  createdAt: 'x',
  archivedAt: null,
  prices: [],
  ...over,
});

describe('warehouseParam и stockHref', () => {
  const warehouses = [{ id: 3 }, { id: 5 }];
  it('склад из адреса — только существующий', () => {
    expect(warehouseParam(new URLSearchParams('warehouse=5'), warehouses)).toBe(5);
    expect(warehouseParam(new URLSearchParams('warehouse=9'), warehouses)).toBeNull();
    expect(warehouseParam(new URLSearchParams('warehouse=abc'), warehouses)).toBeNull();
    expect(warehouseParam(new URLSearchParams(''), warehouses)).toBeNull();
    expect(warehouseParam(new URLSearchParams('warehouse=5'), undefined)).toBeNull();
  });
  it('адрес подвкладки сохраняет склад', () => {
    expect(stockHref(2, 'balance', 3)).toBe('/c/2/stock/balance?warehouse=3');
    expect(stockHref(2, 'items', null)).toBe('/c/2/stock/items');
  });
});

describe('filterItems', () => {
  const groups = [group(1, 'Напитки'), group(2, 'Еда')];
  const items = [item(1, 'Кола 0,5', { groupId: 1, barcode: '4870001' }), item(2, 'Чипсы', { groupId: 2 }), item(3, 'Сироп')];
  it('по названию без учёта регистра, по штрихкоду и по группе', () => {
    expect(filterItems(items, groups, 'КОЛА').map((i) => i.id)).toEqual([1]);
    expect(filterItems(items, groups, '4870').map((i) => i.id)).toEqual([1]);
    expect(filterItems(items, groups, 'еда').map((i) => i.id)).toEqual([2]);
    expect(filterItems(items, groups, '  ').map((i) => i.id)).toEqual([1, 2, 3]);
    expect(filterItems(items, groups, 'нет такого')).toEqual([]);
  });
});

describe('itemSections', () => {
  it('группы по порядку, затем «Без группы»; архивные в конце группы; пустые группы скрыты', () => {
    const groups = [group(1, 'Напитки'), group(2, 'Еда'), group(3, 'Пустая')];
    const items = [
      item(1, 'Кола 0,5', { groupId: 1, archivedAt: 'x' }),
      item(2, 'Сок', { groupId: 1 }),
      item(3, 'Чипсы', { groupId: 2 }),
      item(4, 'Сироп'),
      item(5, 'Забытый', { groupId: 99 }),
    ];
    expect(itemSections(items, groups).map((s) => [s.title, s.items.map((i) => i.id)])).toEqual([
      ['Напитки', [2, 1]],
      ['Еда', [3]],
      ['Без группы', [4, 5]],
    ]);
  });
});

describe('прочее', () => {
  it('история цены — новые сверху', () => {
    expect(priceHistoryRows([{ price: 1, validFrom: '2026-09-01' }, { price: 3, validFrom: '2026-10-01' }, { price: 2, validFrom: '2026-09-15' }]).map((p) => p.price)).toEqual([3, 2, 1]);
  });
  it('проекты без склада — только неархивные; название «Бар {проект}»', () => {
    const projects = [
      { id: 1, archivedAt: null },
      { id: 2, archivedAt: null },
      { id: 3, archivedAt: 'x' },
    ];
    expect(projectsWithoutWarehouse(projects, [{ projectId: 2 }]).map((p) => p.id)).toEqual([1]);
    expect(defaultWarehouseName('Клуб 1')).toBe('Бар Клуб 1');
  });
});

describe('markupText', () => {
  it('сотые доли процента → «+233,3 %», минус с U+2212, ноль и неизвестная закупка', () => {
    expect(markupText(23_333)).toBe('+233,3 %');
    expect(markupText(10_000)).toBe('+100 %');
    expect(markupText(-1250)).toBe('\u221212,5 %');
    expect(markupText(0)).toBe('0 %');
    expect(markupText(2)).toBe('0 %');
    expect(markupText(null)).toBe('—');
  });
  it('qtyWithUnit', () => {
    expect(qtyWithUnit(8000, 'pcs')).toBe('8 шт');
    expect(qtyWithUnit(1500, 'l')).toBe('1,5 л');
  });
});

describe('balanceSections', () => {
  const groups = [group(1, 'Напитки')];
  const items = [item(1, 'Кола 0,5', { groupId: 1 }), item(2, 'Чипсы'), item(3, 'Сироп', { unit: 'l' })];
  const b = (itemId: number, over: Partial<BalanceItem> = {}): BalanceItem => ({
    itemId,
    qty: 0,
    qtyLeft: 0,
    deficit: 0,
    deficitAt: null,
    cost: 0,
    avgCost: null,
    salePrice: 0,
    markupBp: null,
    low: false,
    batches: [],
    ...over,
  });
  const balance = [b(1, { qty: 5000, qtyLeft: 5000, cost: 100 }), b(2), b(3, { qty: -1000, deficit: 1000 })];

  it('без остатка скрыты, долг и «Мало» показываются', () => {
    expect(balanceSections(balance, items, groups, { showEmpty: false, query: '' }).map((s) => [s.title, s.rows.map((r) => r.item.id)])).toEqual([
      ['Напитки', [1]],
      ['Без группы', [3]],
    ]);
    const low = [b(1), b(2, { low: true }), b(3)];
    expect(balanceSections(low, items, groups, { showEmpty: false, query: '' }).flatMap((s) => s.rows.map((r) => r.item.id))).toEqual([2]);
  });

  it('«Показывать товары без остатка» и поиск', () => {
    expect(balanceSections(balance, items, groups, { showEmpty: true, query: '' }).flatMap((s) => s.rows.map((r) => r.item.id))).toEqual([1, 2, 3]);
    expect(balanceSections(balance, items, groups, { showEmpty: true, query: 'чип' }).flatMap((s) => s.rows.map((r) => r.item.id))).toEqual([2]);
  });

  it('товар без строки остатков не показывается', () => {
    expect(balanceSections([b(1, { qty: 1000, qtyLeft: 1000, cost: 1 })], items, groups, { showEmpty: true, query: '' }).flatMap((s) => s.rows.map((r) => r.item.id))).toEqual([1]);
  });
});
