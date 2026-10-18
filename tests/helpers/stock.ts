import { opsWorld, type OpsWorld } from './ops';

export interface StockWorld extends OpsWorld {
  /** Базовый путь склада: /api/v1/companies/:cid/stock */
  stock: string;
  /** Склад проекта «Клуб 1». */
  wh: number;
  /** Склад проекта «Клуб 2». */
  wh2: number;
  /** «Кола 0,5», штуки. */
  cola: number;
  /** «Чипсы», штуки. */
  chips: number;
  /** «Сироп», литры. */
  syrup: number;
  /** Поставщик «Поставщик А». */
  supplier: number;
  /** Покупатель «Сотрудник А». */
  buyer: number;
  /** Создаёт документ склада и возвращает его; ошибка запроса — исключение. */
  doc(body: Record<string, unknown>): Promise<any>;
  /** Поступление на склад «Клуб 1»: lines — [товар, количество (тысячные), сумма]. */
  receipt(at: string, lines: [number, number, number][], extra?: Record<string, unknown>): Promise<any>;
  /** Продажа со склада «Клуб 1»: lines — [товар, количество (тысячные), сумма]. */
  sale(at: string, lines: [number, number, number][], extra?: Record<string, unknown>): Promise<any>;
  /** Списание со склада «Клуб 1»: lines — [товар, количество (тысячные)]. */
  writeoff(at: string, lines: [number, number][], extra?: Record<string, unknown>): Promise<any>;
  /** Перемещение со склада `from` на склад `to`: lines — [товар, количество (тысячные)]. */
  transfer(at: string, from: number, to: number, lines: [number, number][], extra?: Record<string, unknown>): Promise<any>;
}

/** Мир операций плюс склады обоих клубов, три товара, поставщик и покупатель. «Сейчас» — 2026-10-06 12:00 UTC. */
export async function stockWorld(now?: string): Promise<StockWorld> {
  const w = await opsWorld(now);
  const stock = `/api/v1/companies/${w.cid}/stock`;
  const wh = (await w.post(`${stock}/warehouses`, { projectId: w.project, name: 'Бар Клуб 1' })).warehouse.id as number;
  const wh2 = (await w.post(`${stock}/warehouses`, { projectId: w.project2, name: 'Бар Клуб 2' })).warehouse.id as number;
  const item = async (name: string, unit: string, salePrice = 0) =>
    (await w.post(`${stock}/items`, { name, unit, salePrice })).item.id as number;
  const cola = await item('Кола 0,5', 'pcs', 50000);
  const chips = await item('Чипсы', 'pcs', 70000);
  const syrup = await item('Сироп', 'l');
  const supplier = (await w.post(`/api/v1/companies/${w.cid}/counterparties`, { type: 'supplier', name: 'Поставщик А' })).counterparty.id as number;
  const buyer = (await w.post(`/api/v1/companies/${w.cid}/counterparties`, { type: 'employee', name: 'Сотрудник А' })).counterparty.id as number;
  const doc = async (body: Record<string, unknown>) => (await w.post(`${stock}/docs`, body)).doc;
  return {
    ...w,
    stock,
    wh,
    wh2,
    cola,
    chips,
    syrup,
    supplier,
    buyer,
    doc,
    receipt: (at, lines, extra = {}) =>
      doc({ type: 'receipt', at, warehouseId: wh, counterpartyId: supplier, lines: lines.map(([itemId, qty, amount]) => ({ itemId, qty, amount })), ...extra }),
    sale: (at, lines, extra = {}) => doc({ type: 'sale', at, warehouseId: wh, lines: lines.map(([itemId, qty, amount]) => ({ itemId, qty, amount })), ...extra }),
    writeoff: (at, lines, extra = {}) =>
      doc({ type: 'writeoff', at, warehouseId: wh, reason: 'defect', lines: lines.map(([itemId, qty]) => ({ itemId, qty })), ...extra }),
    transfer: (at, from, to, lines, extra = {}) =>
      doc({ type: 'transfer', at, warehouseId: from, toWarehouseId: to, lines: lines.map(([itemId, qty]) => ({ itemId, qty })), ...extra }),
  };
}
