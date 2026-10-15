import { and, eq, sql } from 'drizzle-orm';
import { runFifo, type FifoEvent, type FifoResult } from '../../../shared/stock-fifo';
import type { Executor } from '../../db/client';
import { stockAllocations, stockBatches } from '../../db/schema';

/** Пара (склад, товар): партии и списания считаются отдельно по каждой паре (§5.2). */
export interface Pair {
  warehouseId: number;
  itemId: number;
}

export const pairKey = (p: Pair): string => `${p.warehouseId}:${p.itemId}`;

/** Список пар без повторов. */
export function uniquePairs(pairs: readonly Pair[]): Pair[] {
  const seen = new Map<string, Pair>();
  for (const p of pairs) seen.set(pairKey(p), { warehouseId: p.warehouseId, itemId: p.itemId });
  return [...seen.values()];
}

/** Состояние строки списания (продажи, списания) пары: сколько себестоимости и сколько осталось без партии. */
export interface LineSig {
  lineId: number;
  docId: number;
  type: 'sale' | 'writeoff';
  at: string;
  qty: number;
  cost: number;
  uncovered: number;
}

interface PairRow {
  lineId: number;
  docId: number;
  position: number;
  type: string;
  at: string;
  qty: number;
  amount: number | null;
}

/** Строки пары из непомеченных удалёнными проведённых документов поступления, продажи и списания. */
function liveRows(tx: Executor, p: Pair): PairRow[] {
  return tx.all<PairRow>(sql`
    SELECT l.id AS lineId, l.doc_id AS docId, l.position AS position, d.type AS type, d.at AS at, l.qty AS qty, l.amount AS amount
      FROM stock_doc_lines l JOIN stock_docs d ON d.id = l.doc_id
     WHERE d.warehouse_id = ${p.warehouseId} AND l.item_id = ${p.itemId}
       AND d.deleted_at IS NULL AND d.status = 'posted' AND d.type IN ('receipt', 'sale', 'writeoff')`);
}

/** События пары для ядра FIFO. */
export function eventsOf(rows: readonly PairRow[]): FifoEvent[] {
  return rows.map((r) =>
    r.type === 'receipt'
      ? { kind: 'in', key: r.lineId, at: r.at, docId: r.docId, position: r.position, qty: r.qty, cost: r.amount ?? 0 }
      : { kind: 'out', key: r.lineId, at: r.at, docId: r.docId, position: r.position, qty: r.qty },
  );
}

/** Строки списания пары как они записаны в базе сейчас (до пересчёта): для подсчёта изменившихся продаж. */
export function storedSigs(tx: Executor, p: Pair): Map<number, LineSig> {
  const rows = tx.all<{ lineId: number; docId: number; type: 'sale' | 'writeoff'; at: string; qty: number; covered: number; cost: number }>(sql`
    SELECT l.id AS lineId, l.doc_id AS docId, d.type AS type, d.at AS at, l.qty AS qty,
           COALESCE(SUM(CASE WHEN a.batch_id IS NOT NULL THEN a.qty END), 0) AS covered,
           COALESCE(SUM(a.cost), 0) AS cost
      FROM stock_doc_lines l
      JOIN stock_docs d ON d.id = l.doc_id
      LEFT JOIN stock_allocations a ON a.line_id = l.id
     WHERE d.warehouse_id = ${p.warehouseId} AND l.item_id = ${p.itemId}
       AND d.deleted_at IS NULL AND d.status = 'posted' AND d.type IN ('sale', 'writeoff')
     GROUP BY l.id`);
  return new Map(rows.map((r) => [r.lineId, { lineId: r.lineId, docId: r.docId, type: r.type, at: r.at, qty: r.qty, cost: r.cost, uncovered: r.qty - r.covered }]));
}

/** Шаг 1: убрать партии и списания пары. Вызывается до изменения строк документов — на них ссылаются внешние ключи. */
export function clearPair(tx: Executor, p: Pair): void {
  tx.run(sql`
    DELETE FROM stock_allocations
     WHERE line_id IN (SELECT l.id FROM stock_doc_lines l JOIN stock_docs d ON d.id = l.doc_id WHERE d.warehouse_id = ${p.warehouseId} AND l.item_id = ${p.itemId})
        OR batch_id IN (SELECT id FROM stock_batches WHERE warehouse_id = ${p.warehouseId} AND item_id = ${p.itemId})`);
  tx.delete(stockBatches).where(and(eq(stockBatches.warehouseId, p.warehouseId), eq(stockBatches.itemId, p.itemId))).run();
}

const CHUNK = 400;

/** Шаг 2: построить партии и списания пары по документам (§5.2) и записать их. */
export function buildPair(tx: Executor, p: Pair): { result: FifoResult; sigs: Map<number, LineSig> } {
  const rows = liveRows(tx, p);
  const result = runFifo(eventsOf(rows));
  const byLine = new Map(rows.map((r) => [r.lineId, r]));
  const batchIds = new Map<number, number>();
  for (const b of result.batches) {
    const row = tx
      .insert(stockBatches)
      .values({
        warehouseId: p.warehouseId,
        itemId: p.itemId,
        originLineId: b.key,
        sourceBatchId: null,
        at: b.at,
        qtyIn: b.qtyIn,
        costIn: b.costIn,
        qtyLeft: b.qtyLeft,
        costLeft: b.costLeft,
      })
      .returning({ id: stockBatches.id })
      .get();
    batchIds.set(b.key, row.id);
  }
  const values: (typeof stockAllocations.$inferInsert)[] = [];
  const sigs = new Map<number, LineSig>();
  for (const o of result.outs.values()) {
    const line = byLine.get(o.key)!;
    let cost = 0;
    for (const t of o.takes) {
      values.push({ lineId: o.key, batchId: t.batchKey === null ? null : batchIds.get(t.batchKey)!, qty: t.qty, cost: t.cost });
      cost += t.cost ?? 0;
    }
    sigs.set(o.key, { lineId: o.key, docId: line.docId, type: line.type as 'sale' | 'writeoff', at: line.at, qty: line.qty, cost, uncovered: o.uncovered });
  }
  for (let i = 0; i < values.length; i += CHUNK) tx.insert(stockAllocations).values(values.slice(i, i + CHUNK)).run();
  return { result, sigs };
}
