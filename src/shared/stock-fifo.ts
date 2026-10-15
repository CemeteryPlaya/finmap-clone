/**
 * FIFO по партиям (§5.2 спецификации «Склад»): чистое ядро без базы. Пара (склад, товар) — упорядоченный список
 * событий: поступление создаёт партию, продажа и списание берут из самых ранних партий с остатком.
 * Количества — тысячные доли, стоимости — минимальные единицы валюты. Порядок событий — (at, docId, position);
 * `runFifo` сортирует сам, поэтому проход по любому порядку входа даёт один и тот же результат.
 */
export interface FifoMoment {
  /** ISO-момент UTC фиксированной ширины (`toISOString`): сравнивается как строка. */
  at: string;
  docId: number;
  position: number;
}

export interface FifoIn extends FifoMoment {
  kind: 'in';
  /** Строка документа, создающая партию (origin_line_id). */
  key: number;
  qty: number;
  cost: number;
}

export interface FifoOut extends FifoMoment {
  kind: 'out';
  /** Строка документа, из которой списано. */
  key: number;
  qty: number;
}

export type FifoEvent = FifoIn | FifoOut;

export interface FifoBatch {
  key: number;
  at: string;
  qtyIn: number;
  costIn: number;
  qtyLeft: number;
  costLeft: number;
}

/** Часть списания: из партии `batchKey`; пустая партия и пустая стоимость — не хватило остатка (§5.3). */
export interface FifoTake {
  batchKey: number | null;
  qty: number;
  cost: number | null;
}

export interface FifoOutResult {
  key: number;
  takes: FifoTake[];
  /** Остаток пары перед этим списанием. */
  available: number;
  /** Сколько не нашло партии. */
  uncovered: number;
}

export interface FifoResult {
  /** Партии в порядке прихода; остаток — после последнего события. */
  batches: FifoBatch[];
  outs: Map<number, FifoOutResult>;
}

export function compareMoment(a: FifoMoment, b: FifoMoment): number {
  if (a.at !== b.at) return a.at < b.at ? -1 : 1;
  if (a.docId !== b.docId) return a.docId - b.docId;
  return a.position - b.position;
}

/**
 * Стоимость части партии (§5.2): взята вся — остаток стоимости, иначе floor(costLeft × q / qtyLeft).
 * Остаток стоимости остаётся в партии, последняя единица забирает его: сумма себестоимостей равна сумме закупок.
 */
export function takeCost(costLeft: number, qtyLeft: number, q: number): number {
  if (q >= qtyLeft) return costLeft;
  return Number((BigInt(costLeft) * BigInt(q)) / BigInt(qtyLeft));
}

export function runFifo(events: readonly FifoEvent[]): FifoResult {
  const sorted = [...events].sort(compareMoment);
  const batches: FifoBatch[] = [];
  const outs = new Map<number, FifoOutResult>();
  /** Первая партия, в которой может быть остаток: опустошённые не просматриваются заново. */
  let head = 0;
  let stock = 0;
  for (const e of sorted) {
    if (e.kind === 'in') {
      batches.push({ key: e.key, at: e.at, qtyIn: e.qty, costIn: e.cost, qtyLeft: e.qty, costLeft: e.cost });
      stock += e.qty;
      continue;
    }
    const takes: FifoTake[] = [];
    let left = e.qty;
    for (let i = head; i < batches.length && left > 0; i++) {
      const b = batches[i]!;
      if (b.qtyLeft === 0) continue;
      const q = Math.min(left, b.qtyLeft);
      const cost = takeCost(b.costLeft, b.qtyLeft, q);
      b.qtyLeft -= q;
      b.costLeft -= cost;
      takes.push({ batchKey: b.key, qty: q, cost });
      left -= q;
    }
    while (head < batches.length && batches[head]!.qtyLeft === 0) head++;
    if (left > 0) takes.push({ batchKey: null, qty: left, cost: null });
    outs.set(e.key, { key: e.key, takes, available: stock, uncovered: left });
    stock -= e.qty - left;
  }
  return { batches, outs };
}

/** Итоги прохода: остаток и его стоимость, взятое и его себестоимость, не нашедшее партии. */
export function fifoTotals(r: FifoResult): { qtyLeft: number; costLeft: number; qtyTaken: number; costTaken: number; uncovered: number } {
  let costTaken = 0;
  let qtyTaken = 0;
  let uncovered = 0;
  for (const o of r.outs.values()) {
    uncovered += o.uncovered;
    for (const t of o.takes) {
      if (t.batchKey === null) continue;
      qtyTaken += t.qty;
      costTaken += t.cost ?? 0;
    }
  }
  return {
    qtyLeft: r.batches.reduce((s, b) => s + b.qtyLeft, 0),
    costLeft: r.batches.reduce((s, b) => s + b.costLeft, 0),
    qtyTaken,
    costTaken,
    uncovered,
  };
}
