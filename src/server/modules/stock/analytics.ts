import { and, asc, eq, sql, type SQL } from 'drizzle-orm';
import { getCurrency } from '../../../shared/currencies';
import { addDays, formatDateRu, startOfDayUtc, todayInTimezone } from '../../../shared/dates';
import type { StockItemStat, StockLists, StockPrices, StockTotals } from '../../../shared/schemas/stock';
import { formatQty } from '../../../shared/stock-qty';
import { priceAt } from '../../../shared/stock-price';
import type { Db } from '../../db/client';
import { companies, stockItemGroups, stockItemPrices, stockItems, stockWarehouses } from '../../db/schema';
import { AppError } from '../../errors';
import { exportFileName } from '../../http/export-name';
import { buildXlsx, type XlsxCell } from '../../http/xlsx';
import { requireCompany } from '../companies/guard';
import { minorToDecimal } from '../operations/journal-export';
import type { StockBalanceService } from './balance';

export interface StockAnalyticsQuery {
  from: string;
  to: string;
  warehouse?: number;
}

export interface StockAnalyticsService {
  items(companyId: number, q: StockAnalyticsQuery): { rows: StockItemStat[]; totals: StockTotals };
  lists(companyId: number, q: { warehouse?: number; days: number }): StockLists;
  prices(companyId: number, itemId: number, q: StockAnalyticsQuery): StockPrices;
  exportXlsx(companyId: number, q: StockAnalyticsQuery): { fileName: string; data: Buffer };
}

/** n / d с округлением половины от нуля; d > 0. Через bigint: суммы × 10 000 не помещаются в безопасное целое. */
function roundDiv(n: bigint, d: bigint): number {
  const q = n >= 0n ? (2n * n + d) / (2n * d) : -((-2n * n + d) / (2n * d));
  return Number(q);
}

const ratio = (a: number, mul: number, b: number): number | null => (b === 0 ? null : roundDiv(BigInt(a) * BigInt(mul), BigInt(b)));

interface ItemSums {
  qty: number;
  amount: number;
  cost: number;
  noBatch: number;
}

/**
 * Аналитика склада (§8 спецификации «Склад», решение 10 плана Склад-3): строки по товарам и итоги за период по дате
 * документа, списки «Мало», «Без движения», «Нет партии», динамика цен и подсказка о падении маржи, выгрузка в Excel.
 * Читает производные таблицы (`stock_allocations`, `stock_batches`); стоимость склада на дату — проходом `balance`.
 */
export function createStockAnalyticsService(d: { db: Db; balance: StockBalanceService; timezone: string; now?: () => Date }): StockAnalyticsService {
  const { db } = d;
  const now = d.now ?? (() => new Date());
  const tz = d.timezone;

  function checkWarehouse(companyId: number, warehouse: number | undefined): void {
    if (warehouse === undefined) return;
    const wh = db.select().from(stockWarehouses).where(and(eq(stockWarehouses.id, warehouse), eq(stockWarehouses.companyId, companyId))).get();
    if (!wh) throw new AppError(422, 'INVARIANT_5', 'Склад не найден в этой компании', { warehouse: 'Склад не найден в этой компании' });
  }

  /** Документы компании за период (по `at` и часам компании), проведённые и неудалённые, на складе или на всех. */
  const scope = (companyId: number, q: StockAnalyticsQuery): SQL => sql`
    d.company_id = ${companyId} AND d.deleted_at IS NULL AND d.status = 'posted'
    AND d.at >= ${startOfDayUtc(q.from, tz)} AND d.at < ${startOfDayUtc(addDays(q.to, 1), tz)}
    ${q.warehouse === undefined ? sql.empty() : sql`AND d.warehouse_id = ${q.warehouse}`}`;

  const byItem = (rows: (ItemSums & { itemId: number })[]) => new Map(rows.map((r) => [r.itemId, r]));

  function items(companyId: number, q: StockAnalyticsQuery): { rows: StockItemStat[]; totals: StockTotals } {
    requireCompany(db, companyId);
    checkWarehouse(companyId, q.warehouse);
    const where = scope(companyId, q);
    // продажи: себестоимость и непокрытое строки — по её списаниям (у строки комплекта — по всем составляющим)
    const sales = byItem(
      db.all<ItemSums & { itemId: number }>(sql`
        SELECT l.item_id AS itemId, COALESCE(SUM(l.qty), 0) AS qty, COALESCE(SUM(l.amount), 0) AS amount,
               COALESCE(SUM((SELECT SUM(a.cost) FROM stock_allocations a WHERE a.line_id = l.id)), 0) AS cost,
               COALESCE(SUM((SELECT SUM(a.qty) FROM stock_allocations a WHERE a.line_id = l.id AND a.batch_id IS NULL)), 0) AS noBatch
          FROM stock_doc_lines l JOIN stock_docs d ON d.id = l.doc_id
         WHERE ${where} AND d.type = 'sale'
         GROUP BY l.item_id`),
    );
    // потери — списания и недостачи инвентаризаций: количество — взятое, а не строка (у инвентаризации строка — разница)
    const losses = byItem(
      db.all<ItemSums & { itemId: number }>(sql`
        SELECT l.item_id AS itemId, COALESCE(SUM(a.qty), 0) AS qty, 0 AS amount, COALESCE(SUM(a.cost), 0) AS cost, 0 AS noBatch
          FROM stock_allocations a JOIN stock_doc_lines l ON l.id = a.line_id JOIN stock_docs d ON d.id = l.doc_id
         WHERE ${where} AND d.type IN ('writeoff', 'count')
         GROUP BY l.item_id`),
    );
    const purchases = byItem(
      db.all<ItemSums & { itemId: number }>(sql`
        SELECT l.item_id AS itemId, COALESCE(SUM(l.qty), 0) AS qty, COALESCE(SUM(l.amount), 0) AS amount, 0 AS cost, 0 AS noBatch
          FROM stock_doc_lines l JOIN stock_docs d ON d.id = l.doc_id
         WHERE ${where} AND d.type = 'receipt'
         GROUP BY l.item_id`),
    );
    // излишки инвентаризаций — по товарам: товар только с излишком за период тоже получает строку
    const surplusByItem = new Map(
      db
        .all<{ itemId: number; v: number }>(sql`
          SELECT l.item_id AS itemId, COALESCE(SUM(b.cost_in), 0) AS v
            FROM stock_batches b JOIN stock_doc_lines l ON l.id = b.origin_line_id JOIN stock_docs d ON d.id = l.doc_id
           WHERE ${where} AND d.type = 'count' AND b.source_batch_id IS NULL
           GROUP BY l.item_id`)
        .map((r) => [r.itemId, r.v]),
    );
    const surplus = [...surplusByItem.values()].reduce((a, v) => a + v, 0);

    const ids = new Set([...sales.keys(), ...losses.keys(), ...purchases.keys(), ...surplusByItem.keys()]);
    const catalog = db.select().from(stockItems).where(eq(stockItems.companyId, companyId)).orderBy(asc(stockItems.nameKey), asc(stockItems.id)).all();
    const rows: StockItemStat[] = [];
    for (const item of catalog) {
      if (!ids.has(item.id)) continue;
      const s = sales.get(item.id);
      const l = losses.get(item.id);
      const p = purchases.get(item.id);
      const revenue = s?.amount ?? 0;
      const cost = s?.cost ?? 0;
      const soldQty = s?.qty ?? 0;
      rows.push({
        itemId: item.id,
        groupId: item.groupId,
        isCombo: item.isCombo,
        soldQty,
        revenue,
        cost,
        profit: revenue - cost,
        marginBp: ratio(revenue - cost, 10_000, revenue),
        lossQty: l?.qty ?? 0,
        lossCost: l?.cost ?? 0,
        avgSalePrice: ratio(revenue, 1000, soldQty),
        avgPurchasePrice: p ? ratio(p.amount, 1000, p.qty) : null,
        noBatchQty: s?.noBatch ?? 0,
      });
    }
    const sum = (f: (r: StockItemStat) => number) => rows.reduce((a, r) => a + f(r), 0);
    // стоимость — по тем же складам, что и строки: без склада — все, архивные тоже (R4)
    const valueAt = (day: string) => d.balance.balance(companyId, { warehouse: q.warehouse, at: day, archived: true }).total;
    const valueStart = valueAt(addDays(q.from, -1));
    const valueEnd = valueAt(q.to);
    const totals: StockTotals = {
      revenue: sum((r) => r.revenue),
      cost: sum((r) => r.cost),
      profit: sum((r) => r.profit),
      losses: sum((r) => r.lossCost),
      surplus,
      purchased: [...purchases.values()].reduce((a, p) => a + p.amount, 0),
      valueStart,
      valueEnd,
      valueChange: valueEnd - valueStart,
    };
    return { rows, totals };
  }

  return {
    items,

    lists(companyId, q) {
      requireCompany(db, companyId);
      checkWarehouse(companyId, q.warehouse);
      const balance = d.balance.balance(companyId, { warehouse: q.warehouse });
      const minQty = new Map(db.select({ id: stockItems.id, minQty: stockItems.minQty }).from(stockItems).where(eq(stockItems.companyId, companyId)).all().map((i) => [i.id, i.minQty]));
      // последнее движение товара на складах отбора: продажа (и в составе комплекта), без продаж — приход (поступление
      // или перемещение на склад)
      const inScope = (column: SQL) =>
        q.warehouse === undefined
          ? sql`${column} IN (SELECT id FROM stock_warehouses WHERE company_id = ${companyId} AND archived_at IS NULL)`
          : sql`${column} = ${q.warehouse}`;
      const live = sql`d.company_id = ${companyId} AND d.deleted_at IS NULL AND d.status = 'posted'`;
      const moves = db.all<{ itemId: number; kind: 'sale' | 'in'; at: string }>(sql`
        SELECT l.item_id AS itemId, 'sale' AS kind, MAX(d.at) AS at
          FROM stock_doc_lines l JOIN stock_docs d ON d.id = l.doc_id
         WHERE ${live} AND d.type = 'sale' AND ${inScope(sql`d.warehouse_id`)} GROUP BY l.item_id
        UNION ALL
        SELECT p.item_id, 'sale', MAX(d.at)
          FROM stock_doc_lines l JOIN stock_docs d ON d.id = l.doc_id JOIN stock_combo_parts p ON p.combo_id = l.item_id
         WHERE ${live} AND d.type = 'sale' AND ${inScope(sql`d.warehouse_id`)} GROUP BY p.item_id
        UNION ALL
        SELECT l.item_id, 'in', MAX(d.at)
          FROM stock_doc_lines l JOIN stock_docs d ON d.id = l.doc_id
         WHERE ${live} AND ((d.type = 'receipt' AND ${inScope(sql`d.warehouse_id`)}) OR (d.type = 'transfer' AND ${inScope(sql`d.to_warehouse_id`)}))
         GROUP BY l.item_id`);
      const lastSale = new Map<number, string>();
      const lastIn = new Map<number, string>();
      for (const m of moves) {
        const map = m.kind === 'sale' ? lastSale : lastIn;
        const prev = map.get(m.itemId);
        if (!prev || m.at > prev) map.set(m.itemId, m.at);
      }
      const last = new Map([...lastIn, ...lastSale]);
      const cutoff = startOfDayUtc(addDays(todayInTimezone(tz, now()), -q.days), tz);
      const out: StockLists = { low: [], stale: [], noBatch: [] };
      for (const i of balance.items) {
        const min = minQty.get(i.itemId) ?? null;
        if (i.low && min !== null) out.low.push({ itemId: i.itemId, qty: i.qty, minQty: min });
        const lastMoveAt = last.get(i.itemId) ?? null;
        if (i.qty > 0 && (lastMoveAt === null || lastMoveAt < cutoff)) out.stale.push({ itemId: i.itemId, qty: i.qty, lastMoveAt });
        if (i.deficit > 0 && i.deficitAt) out.noBatch.push({ itemId: i.itemId, qty: i.deficit, since: i.deficitAt });
      }
      return out;
    },

    prices(companyId, itemId, q) {
      requireCompany(db, companyId);
      checkWarehouse(companyId, q.warehouse);
      const item = db.select().from(stockItems).where(and(eq(stockItems.id, itemId), eq(stockItems.companyId, companyId))).get();
      if (!item) throw new AppError(404, 'NOT_FOUND', 'Товар не найден');
      const start = startOfDayUtc(q.from, tz);
      const end = startOfDayUtc(addDays(q.to, 1), tz);
      // все закупки до конца периода: последняя цена закупки на дату и подсказка смотрят и раньше периода
      const all = db
        .all<{ at: string; docId: number; docNumber: string; qty: number; amount: number }>(sql`
          SELECT d.at AS at, d.id AS docId, d.number AS docNumber, l.qty AS qty, l.amount AS amount
            FROM stock_doc_lines l JOIN stock_docs d ON d.id = l.doc_id
           WHERE d.company_id = ${companyId} AND d.deleted_at IS NULL AND d.status = 'posted' AND d.type = 'receipt'
             AND l.item_id = ${itemId} AND d.at < ${end}
             ${q.warehouse === undefined ? sql.empty() : sql`AND d.warehouse_id = ${q.warehouse}`}
           ORDER BY d.at, d.id, l.position`)
        .map((r) => ({ at: r.at, docId: r.docId, docNumber: r.docNumber, unitCost: roundDiv(BigInt(r.amount ?? 0) * 1000n, BigInt(r.qty)) }));
      const salePrices = db
        .select({ validFrom: stockItemPrices.validFrom, price: stockItemPrices.price })
        .from(stockItemPrices)
        .where(eq(stockItemPrices.itemId, itemId))
        .orderBy(asc(stockItemPrices.validFrom))
        .all();
      const purchases = all.filter((p) => p.at >= start);
      const dayOf = (iso: string) => todayInTimezone(tz, new Date(iso));
      const lastCostAt = (iso: string) => {
        let cost: number | null = null;
        for (const p of all) if (p.at <= iso) cost = p.unitCost;
        return cost;
      };
      const margin = (price: number, cost: number | null) => (price > 0 && cost !== null ? roundDiv(BigInt(price - cost) * 10_000n, BigInt(price)) : null);
      const points = [
        ...purchases.map((p) => p.at),
        ...salePrices.filter((p) => p.validFrom >= q.from && p.validFrom <= q.to).map((p) => startOfDayUtc(p.validFrom, tz)),
      ].sort();
      const margins = [...new Set(points)].map((at) => ({ at, marginBp: margin(priceAt(salePrices, dayOf(at)), lastCostAt(at)) }));

      // подсказка (§8): последняя закупка дороже предыдущей, а цена продажи с тех пор та же (решение 10, R15)
      let hint: string | null = null;
      const [prev, lastBuy] = all.slice(-2);
      const current = priceAt(salePrices, q.to);
      if (prev && lastBuy && prev.unitCost > 0 && lastBuy.unitCost > prev.unitCost && current > 0 && priceAt(salePrices, dayOf(prev.at)) === current) {
        const growth = roundDiv(BigInt(lastBuy.unitCost - prev.unitCost) * 100n, BigInt(prev.unitCost));
        const fell = roundDiv(BigInt(current - lastBuy.unitCost) * 100n, BigInt(current));
        hint = `Закупка выросла на ${growth}% с ${formatDateRu(dayOf(lastBuy.at))}, маржа упала до ${fell}%`;
      }
      return { purchases, salePrices, margins, hint };
    },

    exportXlsx(companyId, q) {
      const { rows, totals } = items(companyId, q);
      const company = db.select().from(companies).where(eq(companies.id, companyId)).get()!;
      const units = getCurrency(company.baseCurrency).minorUnits;
      const catalog = new Map(db.select().from(stockItems).where(eq(stockItems.companyId, companyId)).all().map((i) => [i.id, i]));
      const groups = new Map(db.select().from(stockItemGroups).where(eq(stockItemGroups.companyId, companyId)).all().map((g) => [g.id, g.name]));
      const warehouse = q.warehouse === undefined ? null : db.select().from(stockWarehouses).where(eq(stockWarehouses.id, q.warehouse)).get();
      const text = (value: string, bold = false): XlsxCell => ({ kind: 'text', value, bold });
      const money = (v: number | null, bold = false): XlsxCell => (v === null ? null : { kind: 'number', value: minorToDecimal(v, units), decimals: units, bold });
      const qty = (v: number): XlsxCell => ({ kind: 'number', value: formatQty(v).replace(/\u202F/g, '').replace(',', '.'), decimals: 3 });
      const pct = (bp: number | null): XlsxCell => (bp === null ? null : { kind: 'number', value: (bp / 100).toFixed(2), decimals: 2 });
      const body: XlsxCell[][] = rows.map((r) => {
        const item = catalog.get(r.itemId)!;
        return [
          text(r.groupId === null ? 'Без группы' : (groups.get(r.groupId) ?? '')),
          text(item.isCombo ? `${item.name} (комплект)` : item.name),
          qty(r.soldQty),
          money(r.revenue),
          money(r.cost),
          money(r.profit),
          pct(r.marginBp),
          money(r.lossCost),
          money(r.avgSalePrice),
          money(r.avgPurchasePrice),
          qty(r.noBatchQty),
        ];
      });
      body.push([
        text(''),
        text('Итого', true),
        null,
        money(totals.revenue, true),
        money(totals.cost, true),
        money(totals.profit, true),
        pct(ratio(totals.profit, 10_000, totals.revenue)),
        money(totals.losses, true),
        null,
        null,
        null,
      ]);
      const titles = ['Группа', 'Товар', 'Продано', 'Выручка', 'Себестоимость', 'Прибыль', 'Маржа, %', 'Списано и недостача', 'Средняя цена продажи', 'Средняя цена закупки', 'Без партии'];
      const totalRows: [string, number][] = [
        ['Выручка', totals.revenue],
        ['Себестоимость продаж', totals.cost],
        ['Прибыль', totals.profit],
        ['Списано и недостача', totals.losses],
        ['Излишки', totals.surplus],
        ['Закуплено за период', totals.purchased],
        ['Стоимость склада на начало', totals.valueStart],
        ['Стоимость склада на конец', totals.valueEnd],
        ['Изменение стоимости склада', totals.valueChange],
      ];
      const summary = { name: 'Итоги', columns: [{ header: 'Показатель', width: 32 }, { header: 'Сумма', width: 18 }], rows: totalRows.map(([label, v]): XlsxCell[] => [text(label), money(v)]) };
      const data = buildXlsx(
        [
          {
            name: 'Товары',
            columns: titles.map((header, i) => ({ header, width: i === 1 ? 32 : 16 })),
            rows: body,
        preamble: [
          [text(`Период: ${formatDateRu(q.from)} – ${formatDateRu(q.to)}`, true)],
          [text(`Склад: ${warehouse ? warehouse.name : 'все склады'}`)],
          ],
          },
          summary,
        ],
        { strings: 'shared' },
      );
      return { fileName: exportFileName(company.name, 'Аналитика склада', now(), tz), data };
    },
  };
}
