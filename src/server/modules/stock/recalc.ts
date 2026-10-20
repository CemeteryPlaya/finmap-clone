import { sql } from 'drizzle-orm';
import { runStock, type StockResult } from '../../../shared/stock-fifo';
import type { Executor } from '../../db/client';
import { exec, rows as sqlRows } from '../../db/raw';
import { stockAllocations, stockBatches } from '../../db/schema';
import { loadGroupEvents, transferClosure, type GroupRow } from './events';

/** Пара (склад, товар): строка документа меняет остатки этой пары. */
export interface Pair {
  warehouseId: number;
  itemId: number;
}

/**
 * Группа пересчёта (решение 4 плана Склад-2): товар и склады, замкнутые по перемещениям этого товара. Без перемещений —
 * прежняя пара (склад, товар); партии и списания группы считаются одним проходом `runStock`.
 */
export interface Group {
  itemId: number;
  warehouseIds: number[];
}

/** Состояние строки взятия (продажи, списания, перемещения, недостачи): себестоимость и сколько осталось без партии. */
export interface LineSig {
  /** Строка и составляющая (R2): `{lineId}:{componentItemId ?? 0}` — составляющие одного комплекта не затирают друг друга. */
  key: string;
  lineId: number;
  docId: number;
  type: 'sale' | 'writeoff' | 'transfer' | 'count';
  at: string;
  qty: number;
  cost: number;
  uncovered: number;
}

/** Группы затронутых пар: товары — по возрастанию id, склады замкнуты по перемещениям товара. */
export async function groupsOf(ex: Executor, companyId: number, pairs: readonly Pair[]): Promise<Group[]> {
  const byItem = new Map<number, Set<number>>();
  for (const p of pairs) byItem.set(p.itemId, (byItem.get(p.itemId) ?? new Set()).add(p.warehouseId));
  const groups: Group[] = [];
  for (const [itemId, whs] of [...byItem.entries()].sort(([a], [b]) => a - b)) {
    groups.push({ itemId, warehouseIds: await transferClosure(ex, companyId, [...whs], itemId) });
  }
  return groups;
}

const ids = (list: readonly number[]) => sql.join(list.map((id) => sql`${id}`), sql`, `);

/** Строки документов на складах группы, из которых товар группы берётся: его собственные и строки комплектов с ним. */
const groupLines = (g: Group) => sql`
  SELECT l.id FROM stock_doc_lines l JOIN stock_docs d ON d.id = l.doc_id WHERE d.warehouse_id IN (${ids(g.warehouseIds)})`;

/** Строки взятия группы, как они записаны в базе сейчас (до пересчёта): для подсчёта изменившихся документов (§5.4). */
export async function storedSigs(tx: Executor, g: Group): Promise<Map<string, LineSig>> {
  const rows = await sqlRows<Omit<LineSig, 'key'> & { comp: number }>(
    tx,
    sql`
    SELECT l.id AS lineId, COALESCE(a.component_item_id, 0) AS comp, l.doc_id AS docId, d.type AS type, d.at AS at, l.qty AS qty,
           COALESCE(SUM(a.cost), 0) AS cost,
           COALESCE(SUM(CASE WHEN a.batch_id IS NULL THEN a.qty END), 0) AS uncovered
      FROM stock_allocations a
      JOIN stock_doc_lines l ON l.id = a.line_id
      JOIN stock_docs d ON d.id = l.doc_id
     WHERE d.warehouse_id IN (${ids(g.warehouseIds)}) AND d.deleted_at IS NULL AND d.status = 'posted'
       AND ((a.component_item_id IS NULL AND l.item_id = ${g.itemId}) OR a.component_item_id = ${g.itemId})
     GROUP BY l.id, a.component_item_id, l.doc_id, d.type, d.at, l.qty`,
  );
  return new Map(
    rows.map(({ comp, ...r }) => {
      const key = `${r.lineId}:${comp}`;
      return [key, { ...r, key }];
    }),
  );
}

/** Шаг 1: убрать партии и списания группы. Вызывается до изменения строк документов — на них ссылаются внешние ключи. */
export async function clearGroup(tx: Executor, g: Group): Promise<void> {
  await exec(
    tx,
    sql`
    DELETE FROM stock_allocations
     WHERE (line_id IN (${groupLines(g)} AND l.item_id = ${g.itemId}) AND component_item_id IS NULL)
        OR (component_item_id = ${g.itemId} AND line_id IN (${groupLines(g)}))
        OR batch_id IN (SELECT id FROM stock_batches WHERE warehouse_id IN (${ids(g.warehouseIds)}) AND item_id = ${g.itemId})`,
  );
  await exec(tx, sql`DELETE FROM stock_batches WHERE warehouse_id IN (${ids(g.warehouseIds)}) AND item_id = ${g.itemId}`);
}

const CHUNK = 400;

/**
 * Шаг 2: построить партии и списания группы по документам (§5.2) и записать их. Партии пишутся в порядке создания,
 * поэтому партия-источник перемещения всегда записана раньше своей копии у получателя.
 */
export async function buildGroup(tx: Executor, companyId: number, g: Group): Promise<{ result: StockResult; rows: GroupRow[]; sigs: Map<string, LineSig> }> {
  const { rows, events } = await loadGroupEvents(tx, companyId, g.itemId, g.warehouseIds);
  const result = runStock(events);
  const byLine = new Map(rows.map((r) => [r.lineId, r]));
  const batchIds: number[] = [];
  for (const b of result.batches) {
    const [row] = await tx
      .insert(stockBatches)
      .values({
        warehouseId: b.wh,
        itemId: g.itemId,
        originLineId: b.originKey,
        sourceBatchId: b.sourceIndex === null ? null : batchIds[b.sourceIndex]!,
        at: b.at,
        qtyIn: b.qtyIn,
        costIn: b.costIn,
        qtyLeft: b.qtyLeft,
        costLeft: b.costLeft,
      })
      .returning({ id: stockBatches.id });
    batchIds.push(row!.id);
  }
  const values: (typeof stockAllocations.$inferInsert)[] = [];
  const sigs = new Map<string, LineSig>();
  for (const o of result.outs.values()) {
    const line = byLine.get(o.key)!;
    let cost = 0;
    for (const t of o.takes) {
      values.push({
        lineId: o.key,
        batchId: t.batchIndex === null ? null : batchIds[t.batchIndex]!,
        qty: t.qty,
        cost: t.cost,
        componentItemId: line.comboItemId === null ? null : g.itemId,
      });
      cost += t.cost ?? 0;
    }
    const key = `${o.key}:${line.comboItemId === null ? 0 : g.itemId}`;
    sigs.set(key, { key, lineId: o.key, docId: line.docId, type: line.type as LineSig['type'], at: line.at, qty: line.qty, cost, uncovered: o.uncovered });
  }
  for (let i = 0; i < values.length; i += CHUNK) await tx.insert(stockAllocations).values(values.slice(i, i + CHUNK));
  return { result, rows, sigs };
}
