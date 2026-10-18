import { sql } from 'drizzle-orm';
import type { StockDocType } from '../../../shared/schemas/stock';
import type { StockEvent } from '../../../shared/stock-fifo';
import type { Executor } from '../../db/client';

/**
 * Строка документа для прохода FIFO (§5.2): строка товара на складе группы или — у составляющей комплекта — строка
 * продажи комплекта с количеством составляющей (`comboItemId` — комплект, `qty` — в единицах составляющей).
 */
export interface GroupRow {
  lineId: number;
  docId: number;
  number: string;
  type: StockDocType;
  at: string;
  position: number;
  warehouseId: number;
  toWarehouseId: number | null;
  counterpartyId: number | null;
  itemId: number;
  qty: number;
  amount: number | null;
  countedQty: number | null;
  expectedQty: number | null;
  comboItemId: number | null;
}

const ids = (list: readonly number[]) => sql.join(list.map((id) => sql`${id}`), sql`, `);

/**
 * Наименьшее множество складов, содержащее данные и замкнутое по проведённым неудалённым перемещениям компании
 * (решение 4 плана Склад-2): с товаром — только по перемещениям его строк. По возрастанию id.
 */
export function transferClosure(ex: Executor, companyId: number, warehouseIds: readonly number[], itemId?: number): number[] {
  const edges = ex.all<{ a: number; b: number }>(sql`
    SELECT DISTINCT d.warehouse_id AS a, d.to_warehouse_id AS b
      FROM stock_docs d
     WHERE d.company_id = ${companyId} AND d.type = 'transfer' AND d.deleted_at IS NULL AND d.status = 'posted' AND d.to_warehouse_id IS NOT NULL
       ${itemId === undefined ? sql.empty() : sql`AND EXISTS (SELECT 1 FROM stock_doc_lines l WHERE l.doc_id = d.id AND l.item_id = ${itemId})`}`);
  const next = new Map<number, number[]>();
  const link = (a: number, b: number) => {
    const list = next.get(a);
    if (list) list.push(b);
    else next.set(a, [b]);
  };
  for (const e of edges) {
    link(e.a, e.b);
    link(e.b, e.a);
  }
  const seen = new Set(warehouseIds);
  const stack = [...seen];
  while (stack.length > 0) {
    for (const n of next.get(stack.pop()!) ?? []) {
      if (seen.has(n)) continue;
      seen.add(n);
      stack.push(n);
    }
  }
  return [...seen].sort((a, b) => a - b);
}

/**
 * Строки проведённых неудалённых документов на складах `warehouseIds` (замкнутых по перемещениям): по одному товару
 * или по всем; `before` — только документы раньше этого момента (остатки на дату).
 */
export function loadRows(ex: Executor, companyId: number, warehouseIds: readonly number[], opts: { itemId?: number; before?: string } = {}): GroupRow[] {
  if (warehouseIds.length === 0) return [];
  const scope = sql`d.company_id = ${companyId} AND d.warehouse_id IN (${ids(warehouseIds)}) AND d.deleted_at IS NULL AND d.status = 'posted'
    ${opts.before ? sql`AND d.at < ${opts.before}` : sql.empty()}`;
  return ex.all<GroupRow>(sql`
    SELECT l.id AS lineId, d.id AS docId, d.number AS number, d.type AS type, d.at AS at, l.position AS position,
           d.warehouse_id AS warehouseId, d.to_warehouse_id AS toWarehouseId, d.counterparty_id AS counterpartyId,
           l.item_id AS itemId, l.qty AS qty, l.amount AS amount, l.counted_qty AS countedQty, l.expected_qty AS expectedQty,
           NULL AS comboItemId
      FROM stock_doc_lines l JOIN stock_docs d ON d.id = l.doc_id
     WHERE ${scope} ${opts.itemId === undefined ? sql.empty() : sql`AND l.item_id = ${opts.itemId}`}
    UNION ALL
    SELECT l.id, d.id, d.number, d.type, d.at, l.position, d.warehouse_id, d.to_warehouse_id, d.counterparty_id,
           p.item_id, (l.qty * p.qty) / 1000, NULL, NULL, NULL, l.item_id
      FROM stock_doc_lines l JOIN stock_docs d ON d.id = l.doc_id JOIN stock_combo_parts p ON p.combo_id = l.item_id
     WHERE ${scope} AND d.type = 'sale' ${opts.itemId === undefined ? sql.empty() : sql`AND p.item_id = ${opts.itemId}`}`);
}

/**
 * События FIFO строки: поступление — приход; продажа, списание и составляющая комплекта — взятие; перемещение — со склада
 * на склад; проведённая инвентаризация — недостача (взятие) или излишек по знаку «факт \u2212 учёт», без разницы — ничего.
 */
export function eventOf(r: GroupRow): StockEvent | null {
  const base = { key: r.lineId, at: r.at, docId: r.docId, position: r.position, wh: r.warehouseId };
  switch (r.type) {
    case 'receipt':
      return { ...base, kind: 'in', qty: r.qty, cost: r.amount ?? 0 };
    case 'sale':
    case 'writeoff':
      return { ...base, kind: 'out', qty: r.qty };
    case 'transfer':
      return { ...base, kind: 'move', to: r.toWarehouseId!, qty: r.qty };
    case 'count': {
      const diff = (r.countedQty ?? 0) - (r.expectedQty ?? 0);
      if (r.countedQty === null || r.expectedQty === null || diff === 0) return null;
      return diff < 0 ? { ...base, kind: 'out', qty: -diff } : { ...base, kind: 'surplus', qty: diff };
    }
  }
}

/** Строки и события одного товара на складах группы. */
export function loadGroupEvents(ex: Executor, companyId: number, itemId: number, warehouseIds: readonly number[], opts: { before?: string } = {}): { rows: GroupRow[]; events: StockEvent[] } {
  const rows = loadRows(ex, companyId, warehouseIds, { itemId, before: opts.before });
  return { rows, events: rows.map(eventOf).filter((e): e is StockEvent => e !== null) };
}
