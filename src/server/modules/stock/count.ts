import { sql } from 'drizzle-orm';
import { qtyAt, runStock, type FifoMoment } from '../../../shared/stock-fifo';
import type { Executor } from '../../db/client';
import { eventOf, loadGroupEvents, loadRows, transferClosure } from './events';

/**
 * Учёт инвентаризации (§7, решение 7): остаток склада строго перед моментом документа по каждому товару — один запрос
 * по складам, связанным перемещениями. Без `itemIds` — все товары с движением; товары без движения в ответ не попадают.
 */
export function expectedQtys(ex: Executor, companyId: number, warehouseId: number, moment: FifoMoment, itemIds?: readonly number[]): Map<number, number> {
  const rows = loadRows(ex, companyId, transferClosure(ex, companyId, [warehouseId]));
  const wanted = itemIds ? new Set(itemIds) : null;
  const byItem = new Map<number, ReturnType<typeof eventOf>[]>();
  for (const r of rows) {
    if (wanted && !wanted.has(r.itemId)) continue;
    const list = byItem.get(r.itemId);
    if (list) list.push(eventOf(r));
    else byItem.set(r.itemId, [eventOf(r)]);
  }
  const out = new Map<number, number>();
  for (const [itemId, events] of byItem) out.set(itemId, qtyAt(events.filter((e) => e !== null), warehouseId, moment));
  return out;
}

export interface CountSummary {
  /** Себестоимость недостачи — сумма взятого строками инвентаризации. */
  shortage: number;
  /** Стоимость излишка — сумма партий, созданных строками. */
  surplus: number;
  /** Строк излишка без известной цены (R7). */
  unknownCost: number;
}

/**
 * Итог проведённой инвентаризации (R7): недостача и излишек — из таблиц; «цена неизвестна» в базе не хранится, поэтому
 * проход `runStock` нужен только по товарам, у которых партия излишка вышла по нулевой цене.
 */
export function countSummary(ex: Executor, companyId: number, warehouseId: number, lines: readonly { id: number; itemId: number }[]): CountSummary {
  if (lines.length === 0) return { shortage: 0, surplus: 0, unknownCost: 0 };
  const ids = sql.join(
    lines.map((l) => sql`${l.id}`),
    sql`, `,
  );
  const shortage = ex.get<{ v: number }>(sql`SELECT COALESCE(SUM(cost), 0) AS v FROM stock_allocations WHERE line_id IN (${ids})`)!.v;
  const batches = ex.all<{ lineId: number; costIn: number }>(sql`
    SELECT origin_line_id AS lineId, cost_in AS costIn FROM stock_batches WHERE origin_line_id IN (${ids}) AND source_batch_id IS NULL`);
  let unknownCost = 0;
  for (const b of batches.filter((x) => x.costIn === 0)) {
    const itemId = lines.find((l) => l.id === b.lineId)!.itemId;
    const { events } = loadGroupEvents(ex, companyId, itemId, transferClosure(ex, companyId, [warehouseId], itemId));
    if (runStock(events).batches.some((x) => x.originKey === b.lineId && x.unknownCost)) unknownCost++;
  }
  return { shortage, surplus: batches.reduce((s, b) => s + b.costIn, 0), unknownCost };
}
