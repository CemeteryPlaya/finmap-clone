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

/** Пара (склад, товар) на одном складе: обёртка над `runStock` (склад 0), ключ партии — строка поступления. */
export function runFifo(events: readonly FifoEvent[]): FifoResult {
  const r = runStock(events.map((e) => ({ ...e, wh: 0 })));
  const batches: FifoBatch[] = r.batches.map((b) => ({ key: b.originKey, at: b.at, qtyIn: b.qtyIn, costIn: b.costIn, qtyLeft: b.qtyLeft, costLeft: b.costLeft }));
  const outs = new Map<number, FifoOutResult>();
  for (const o of r.outs.values()) {
    outs.set(o.key, {
      key: o.key,
      takes: o.takes.map((t) => ({ batchKey: t.batchIndex === null ? null : r.batches[t.batchIndex]!.originKey, qty: t.qty, cost: t.cost })),
      available: o.available,
      uncovered: o.uncovered,
    });
  }
  return { batches, outs };
}

/**
 * Событие товара на одном из складов (§5.2, «Склад-2»): поступление, взятие (продажа, списание, недостача инвентаризации,
 * составляющая комплекта), перемещение со склада `wh` на склад `to` и излишек инвентаризации. `key` — строка документа:
 * у одного товара одна строка даёт не больше одного события.
 */
export type StockEvent =
  | (FifoMoment & { kind: 'in'; wh: number; key: number; qty: number; cost: number })
  | (FifoMoment & { kind: 'out'; wh: number; key: number; qty: number })
  | (FifoMoment & { kind: 'move'; wh: number; to: number; key: number; qty: number })
  | (FifoMoment & { kind: 'surplus'; wh: number; key: number; qty: number });

/** Партия: `index` — место в `StockResult.batches`; у партии перемещения `sourceIndex` — партия, из которой она взята. */
export interface StockBatch {
  index: number;
  wh: number;
  /** Строка документа, создавшая партию: поступление, перемещение или излишек. */
  originKey: number;
  sourceIndex: number | null;
  at: string;
  qtyIn: number;
  costIn: number;
  qtyLeft: number;
  costLeft: number;
  /** Излишек без известной цены: на складе не было партий (§5.2, «цена неизвестна»). */
  unknownCost: boolean;
}

/** Часть взятия: из партии `batchIndex`; пустая партия и пустая стоимость — не хватило остатка (§5.3). */
export interface StockTake {
  batchIndex: number | null;
  qty: number;
  cost: number | null;
}

export interface StockOutResult {
  key: number;
  /** Склад, с которого взято (у перемещения — отправитель). */
  wh: number;
  kind: 'out' | 'move';
  takes: StockTake[];
  /** Остаток партий склада перед взятием. */
  available: number;
  uncovered: number;
}

export interface StockResult {
  /** Партии в порядке создания; остаток — после последнего события. */
  batches: StockBatch[];
  outs: Map<number, StockOutResult>;
}

/** Стоимость количества q по цене партии: floor(costIn × q / qtyIn), через bigint. */
function priceOf(costIn: number, qtyIn: number, q: number): number {
  return Number((BigInt(costIn) * BigInt(q)) / BigInt(qtyIn));
}

/**
 * Проход по событиям одного товара на нескольких складах в порядке (at, docId, position). У каждого склада своя очередь
 * партий; перемещение берёт из очереди отправителя по FIFO и создаёт у получателя по партии на каждое покрытое взятие
 * с той же стоимостью; излишек приходует партию по цене последней созданной партии склада (её «цена неизвестна»
 * наследуется), без партий — по 0 с пометкой. Результат не зависит от порядка входа.
 */
export function runStock(events: readonly StockEvent[]): StockResult {
  const sorted = [...events].sort(compareMoment);
  const batches: StockBatch[] = [];
  const outs = new Map<number, StockOutResult>();
  /** Очередь склада: индексы партий и первая, в которой может быть остаток; последняя созданная партия; остаток партий. */
  const queues = new Map<number, { list: number[]; head: number; last: number | null; stock: number }>();
  const queue = (wh: number) => {
    let q = queues.get(wh);
    if (!q) {
      q = { list: [], head: 0, last: null, stock: 0 };
      queues.set(wh, q);
    }
    return q;
  };
  const addBatch = (b: Omit<StockBatch, 'index' | 'qtyLeft' | 'costLeft'>) => {
    const index = batches.length;
    batches.push({ ...b, index, qtyLeft: b.qtyIn, costLeft: b.costIn });
    const q = queue(b.wh);
    q.list.push(index);
    q.last = index;
    q.stock += b.qtyIn;
  };

  for (const e of sorted) {
    // пустой приход партии не создаёт: партия с нулём количества стала бы «последней» и сломала цену излишка
    if ((e.kind === 'in' || e.kind === 'surplus') && e.qty <= 0) continue;
    if (e.kind === 'in') {
      addBatch({ wh: e.wh, originKey: e.key, sourceIndex: null, at: e.at, qtyIn: e.qty, costIn: e.cost, unknownCost: false });
      continue;
    }
    if (e.kind === 'surplus') {
      const last = queue(e.wh).last;
      const from = last === null ? null : batches[last]!;
      addBatch({
        wh: e.wh,
        originKey: e.key,
        sourceIndex: null,
        at: e.at,
        qtyIn: e.qty,
        costIn: from ? priceOf(from.costIn, from.qtyIn, e.qty) : 0,
        unknownCost: from ? from.unknownCost : true,
      });
      continue;
    }
    const q = queue(e.wh);
    const takes: StockTake[] = [];
    let left = e.qty;
    for (let i = q.head; i < q.list.length && left > 0; i++) {
      const b = batches[q.list[i]!]!;
      if (b.qtyLeft === 0) continue;
      const take = Math.min(left, b.qtyLeft);
      const cost = takeCost(b.costLeft, b.qtyLeft, take);
      b.qtyLeft -= take;
      b.costLeft -= cost;
      takes.push({ batchIndex: b.index, qty: take, cost });
      left -= take;
    }
    while (q.head < q.list.length && batches[q.list[q.head]!]!.qtyLeft === 0) q.head++;
    if (left > 0) takes.push({ batchIndex: null, qty: left, cost: null });
    outs.set(e.key, { key: e.key, wh: e.wh, kind: e.kind, takes, available: q.stock, uncovered: left });
    q.stock -= e.qty - left;
    if (e.kind === 'move') {
      for (const t of takes) {
        if (t.batchIndex === null) continue;
        addBatch({ wh: e.to, originKey: e.key, sourceIndex: t.batchIndex, at: e.at, qtyIn: t.qty, costIn: t.cost!, unknownCost: batches[t.batchIndex]!.unknownCost });
      }
    }
  }
  return { batches, outs };
}

/**
 * Остаток склада строго перед моментом (§7, учёт инвентаризации): поступление и излишек — плюс, взятие — минус,
 * перемещение — минус у отправителя и плюс у получателя. Непокрытое не вычитается отдельно: это остаток «с учётом
 * проданного без партии», как в «Остатках».
 */
export function qtyAt(events: readonly StockEvent[], wh: number, moment: FifoMoment): number {
  let qty = 0;
  for (const e of events) {
    if (compareMoment(e, moment) >= 0) continue;
    if (e.kind === 'move') {
      if (e.wh === wh) qty -= e.qty;
      if (e.to === wh) qty += e.qty;
    } else if (e.wh === wh) {
      qty += e.kind === 'out' ? -e.qty : e.qty;
    }
  }
  return qty;
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
