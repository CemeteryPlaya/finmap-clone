import { asc, eq, sql } from 'drizzle-orm';
import { addDays, startOfDayUtc, todayInTimezone } from '../../../shared/dates';
import { runFifo, type FifoEvent } from '../../../shared/stock-fifo';
import { priceAt } from '../../../shared/stock-price';
import type { Db } from '../../db/client';
import { stockItemPrices, stockItems } from '../../db/schema';
import { requireCompany } from '../companies/guard';

/** Партия в остатках: приход одной строкой документа. */
export interface BalanceBatch {
  lineId: number;
  docId: number;
  docNumber: string;
  warehouseId: number;
  counterpartyId: number | null;
  at: string;
  qtyIn: number;
  costIn: number;
  qtyLeft: number;
  costLeft: number;
}

export interface BalanceItem {
  itemId: number;
  /** Остаток с учётом проданного без партии: может быть меньше нуля. */
  qty: number;
  /** Остаток партий. */
  qtyLeft: number;
  /** Проданное и списанное без партии (§5.3, «Нет партии»). */
  deficit: number;
  /** Момент самой ранней продажи или списания без партии; null — долга нет. */
  deficitAt: string | null;
  /** Себестоимость остатка партий. */
  cost: number;
  /** Средняя цена закупки остатка за единицу; null — остатка партий нет. */
  avgCost: number | null;
  /** Цена продажи на дату остатков. */
  salePrice: number;
  /** Наценка в сотых долях процента ((цена \u2212 закупка) / закупка); null — закупка неизвестна или равна нулю. */
  markupBp: number | null;
  /** Остаток ниже минимального. */
  low: boolean;
  batches: BalanceBatch[];
}

export interface BalanceResult {
  warehouseId: number | null;
  /** Календарная дата остатков; null — на сейчас. */
  at: string | null;
  items: BalanceItem[];
  /** Стоимость склада: сумма остатков партий. */
  total: number;
}

export interface WarehouseValue {
  warehouseId: number;
  projectId: number;
  name: string;
  value: number;
  /** На складе есть продажи или списания без партии: «Нет партии» сама не исчезает. */
  hasDeficit: boolean;
}

export interface StockBalanceService {
  /** Остатки по товарам и партиям на конец дня `at` (без даты — сейчас), по складу или по всем. */
  balance(companyId: number, q: { warehouse?: number; at?: string }): BalanceResult;
  /** Стоимость неархивных складов — для левой панели; в «Всего на счетах» не входит. */
  value(companyId: number): { warehouses: WarehouseValue[]; total: number };
}

interface Row {
  lineId: number;
  docId: number;
  number: string;
  type: string;
  at: string;
  position: number;
  warehouseId: number;
  counterpartyId: number | null;
  itemId: number;
  qty: number;
  amount: number | null;
}

export function createStockBalanceService(d: { db: Db; timezone: string; now?: () => Date }): StockBalanceService {
  const { db } = d;
  const now = d.now ?? (() => new Date());

  return {
    balance(companyId, q) {
      requireCompany(db, companyId);
      const bound = q.at ? startOfDayUtc(addDays(q.at, 1), d.timezone) : null;
      const day = q.at ?? todayInTimezone(d.timezone, now());
      const rows = db.all<Row>(sql`
        SELECT l.id AS lineId, d.id AS docId, d.number AS number, d.type AS type, d.at AS at, l.position AS position,
               d.warehouse_id AS warehouseId, d.counterparty_id AS counterpartyId, l.item_id AS itemId, l.qty AS qty, l.amount AS amount
          FROM stock_doc_lines l JOIN stock_docs d ON d.id = l.doc_id
         WHERE d.company_id = ${companyId} AND d.deleted_at IS NULL AND d.status = 'posted' AND d.type IN ('receipt', 'sale', 'writeoff')
           ${q.warehouse ? sql`AND d.warehouse_id = ${q.warehouse}` : sql`AND d.warehouse_id IN (SELECT id FROM stock_warehouses WHERE company_id = ${companyId} AND archived_at IS NULL)`}
           ${bound ? sql`AND d.at < ${bound}` : sql.empty()}`);

      const pairs = new Map<string, Row[]>();
      for (const r of rows) {
        const key = `${r.warehouseId}:${r.itemId}`;
        const list = pairs.get(key);
        if (list) list.push(r);
        else pairs.set(key, [r]);
      }
      const byItem = new Map<number, { qtyLeft: number; deficit: number; deficitAt: string | null; cost: number; batches: BalanceBatch[] }>();
      for (const list of pairs.values()) {
        const events: FifoEvent[] = list.map((r) =>
          r.type === 'receipt'
            ? { kind: 'in', key: r.lineId, at: r.at, docId: r.docId, position: r.position, qty: r.qty, cost: r.amount ?? 0 }
            : { kind: 'out', key: r.lineId, at: r.at, docId: r.docId, position: r.position, qty: r.qty },
        );
        const result = runFifo(events);
        const info = new Map(list.map((r) => [r.lineId, r]));
        const acc = byItem.get(list[0]!.itemId) ?? { qtyLeft: 0, deficit: 0, deficitAt: null, cost: 0, batches: [] };
        for (const o of result.outs.values()) {
          if (o.uncovered <= 0) continue;
          acc.deficit += o.uncovered;
          const at = info.get(o.key)!.at;
          if (acc.deficitAt === null || at < acc.deficitAt) acc.deficitAt = at;
        }
        for (const b of result.batches) {
          acc.qtyLeft += b.qtyLeft;
          acc.cost += b.costLeft;
          if (b.qtyLeft > 0) {
            const r = info.get(b.key)!;
            acc.batches.push({
              lineId: b.key,
              docId: r.docId,
              docNumber: r.number,
              warehouseId: r.warehouseId,
              counterpartyId: r.counterpartyId,
              at: b.at,
              qtyIn: b.qtyIn,
              costIn: b.costIn,
              qtyLeft: b.qtyLeft,
              costLeft: b.costLeft,
            });
          }
        }
        byItem.set(list[0]!.itemId, acc);
      }

      const prices = new Map<number, { price: number; validFrom: string }[]>();
      for (const p of db
        .select({ itemId: stockItemPrices.itemId, price: stockItemPrices.price, validFrom: stockItemPrices.validFrom })
        .from(stockItemPrices)
        .innerJoin(stockItems, eq(stockItems.id, stockItemPrices.itemId))
        .where(eq(stockItems.companyId, companyId))
        .all()) {
        prices.set(p.itemId, [...(prices.get(p.itemId) ?? []), { price: p.price, validFrom: p.validFrom }]);
      }

      const items: BalanceItem[] = [];
      for (const item of db.select().from(stockItems).where(eq(stockItems.companyId, companyId)).orderBy(asc(stockItems.nameKey), asc(stockItems.id)).all()) {
        const acc = byItem.get(item.id) ?? { qtyLeft: 0, deficit: 0, deficitAt: null, cost: 0, batches: [] };
        const qty = acc.qtyLeft - acc.deficit;
        // архивный товар без остатка и долга в списке не нужен
        if (item.archivedAt && qty === 0 && acc.deficit === 0) continue;
        const avgCost = acc.qtyLeft > 0 ? Number((2n * BigInt(acc.cost) * 1000n + BigInt(acc.qtyLeft)) / (2n * BigInt(acc.qtyLeft))) : null;
        const salePrice = q.at ? priceAt(prices.get(item.id) ?? [], day) : item.salePrice;
        items.push({
          itemId: item.id,
          qty,
          qtyLeft: acc.qtyLeft,
          deficit: acc.deficit,
          deficitAt: acc.deficitAt,
          cost: acc.cost,
          avgCost,
          salePrice,
          markupBp: avgCost !== null && avgCost > 0 ? Math.round(((salePrice - avgCost) * 10000) / avgCost) : null,
          low: item.minQty !== null && qty < item.minQty,
          batches: acc.batches.sort((a, b) => (a.at === b.at ? a.lineId - b.lineId : a.at < b.at ? -1 : 1)),
        });
      }
      return { warehouseId: q.warehouse ?? null, at: q.at ?? null, items, total: items.reduce((s, i) => s + i.cost, 0) };
    },

    value(companyId) {
      requireCompany(db, companyId);
      const rows = db.all<Omit<WarehouseValue, 'hasDeficit'> & { hasDeficit: number }>(sql`
        SELECT w.id AS warehouseId, w.project_id AS projectId, w.name AS name,
               COALESCE((SELECT SUM(b.cost_left) FROM stock_batches b WHERE b.warehouse_id = w.id), 0) AS value,
               EXISTS (
                 SELECT 1 FROM stock_doc_lines l JOIN stock_docs d ON d.id = l.doc_id
                  WHERE d.warehouse_id = w.id AND d.deleted_at IS NULL AND d.status = 'posted' AND d.type IN ('sale', 'writeoff')
                    AND l.qty > COALESCE((SELECT SUM(a.qty) FROM stock_allocations a WHERE a.line_id = l.id AND a.batch_id IS NOT NULL), 0)
               ) AS hasDeficit
          FROM stock_warehouses w
         WHERE w.company_id = ${companyId} AND w.archived_at IS NULL
         ORDER BY w.id`);
      const warehouses = rows.map((r) => ({ ...r, hasDeficit: r.hasDeficit === 1 }));
      return { warehouses, total: warehouses.reduce((s, w) => s + w.value, 0) };
    },
  };
}
