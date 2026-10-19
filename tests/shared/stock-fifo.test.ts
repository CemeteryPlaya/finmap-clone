import { describe, expect, it } from 'vitest';
import {
  batchQtyAt,
  compareMoment,
  fifoTotals,
  qtyAt,
  runFifo,
  runStock,
  takeCost,
  type FifoEvent,
  type FifoIn,
  type FifoOut,
  type StockEvent,
  type StockResult,
} from '../../src/shared/stock-fifo';

let seq = 0;
/** Поступление: key — строка, at — «день», docId растёт сам. */
const inn = (key: number, day: number, qty: number, cost: number, docId = ++seq): FifoIn => ({
  kind: 'in',
  key,
  at: `2026-10-${String(day).padStart(2, '0')}T10:00:00.000Z`,
  docId,
  position: 0,
  qty,
  cost,
});
const out = (key: number, day: number, qty: number, docId = ++seq): FifoOut => ({
  kind: 'out',
  key,
  at: `2026-10-${String(day).padStart(2, '0')}T10:00:00.000Z`,
  docId,
  position: 0,
  qty,
});

describe('takeCost (§5.2)', () => {
  it('взята вся партия — весь остаток стоимости', () => {
    expect(takeCost(100, 3000, 3000)).toBe(100);
  });
  it('часть — floor(costLeft × q / qtyLeft)', () => {
    expect(takeCost(100, 3000, 1000)).toBe(33);
    expect(takeCost(100, 3000, 2000)).toBe(66);
  });
  it('большая стоимость не теряет точность (bigint)', () => {
    expect(takeCost(9_007_199_254_740_991, 3_000_000, 1_000_000)).toBe(3_002_399_751_580_330);
  });
});

describe('runFifo: партии', () => {
  it('несколько партий списываются от самой ранней', () => {
    const r = runFifo([inn(1, 1, 10_000, 1000), inn(2, 2, 10_000, 1500), out(10, 3, 15_000)]);
    const o = r.outs.get(10)!;
    expect(o.takes).toEqual([
      { batchKey: 1, qty: 10_000, cost: 1000 },
      { batchKey: 2, qty: 5000, cost: 750 },
    ]);
    expect(o.available).toBe(20_000);
    expect(o.uncovered).toBe(0);
    expect(r.batches.map((b) => [b.key, b.qtyLeft, b.costLeft])).toEqual([
      [1, 0, 0],
      [2, 5000, 750],
    ]);
  });

  it('частичное взятие: остаток стоимости остаётся в партии, последняя единица забирает его', () => {
    const r = runFifo([inn(1, 1, 3000, 100), out(10, 2, 1000), out(11, 3, 1000), out(12, 4, 1000)]);
    expect([10, 11, 12].map((k) => r.outs.get(k)!.takes[0]!.cost)).toEqual([33, 33, 34]);
    expect(r.batches[0]).toMatchObject({ qtyLeft: 0, costLeft: 0 });
  });

  it('точность тиынов: себестоимость + остаток = закупка при любом дроблении', () => {
    const events: FifoEvent[] = [inn(1, 1, 7000, 1001), inn(2, 2, 3000, 7)];
    let key = 10;
    for (const q of [1000, 1000, 1000, 1000, 1000, 1000, 1000, 1000, 1000, 500]) events.push(out(key++, 3, q));
    const t = fifoTotals(runFifo(events));
    expect(t.costTaken + t.costLeft).toBe(1001 + 7);
    expect(t.qtyTaken + t.qtyLeft).toBe(10_000);
  });

  it('порядок внутри одного момента — по документу и позиции', () => {
    const a = { ...out(10, 1, 1000, 5), position: 1 };
    const b = { ...out(11, 1, 1000, 5), position: 0 };
    const r = runFifo([a, b, inn(1, 1, 1000, 100, 4), { ...inn(2, 1, 1000, 300, 4), position: 1 }]);
    // документ 4 раньше документа 5; внутри 5 первой идёт позиция 0
    expect(r.outs.get(11)!.takes).toEqual([{ batchKey: 1, qty: 1000, cost: 100 }]);
    expect(r.outs.get(10)!.takes).toEqual([{ batchKey: 2, qty: 1000, cost: 300 }]);
  });

  it('compareMoment сравнивает момент, затем документ, затем позицию', () => {
    const m = (at: string, docId: number, position: number) => ({ at, docId, position });
    expect(compareMoment(m('a', 9, 9), m('b', 1, 1))).toBeLessThan(0);
    expect(compareMoment(m('a', 1, 9), m('a', 2, 0))).toBeLessThan(0);
    expect(compareMoment(m('a', 1, 1), m('a', 1, 0))).toBeGreaterThan(0);
    expect(compareMoment(m('a', 1, 1), m('a', 1, 1))).toBe(0);
  });
});

describe('runFifo: минус и его закрытие (§5.3)', () => {
  it('продажа без остатка: партия и себестоимость пустые, «Нет партии»', () => {
    const r = runFifo([out(10, 2, 2000)]);
    expect(r.outs.get(10)).toEqual({ key: 10, takes: [{ batchKey: null, qty: 2000, cost: null }], available: 0, uncovered: 2000 });
  });

  it('остатка хватило на часть: часть из партии, остальное — без партии', () => {
    const r = runFifo([inn(1, 1, 1000, 500), out(10, 2, 3000)]);
    expect(r.outs.get(10)!.takes).toEqual([
      { batchKey: 1, qty: 1000, cost: 500 },
      { batchKey: null, qty: 2000, cost: null },
    ]);
    expect(r.outs.get(10)!.uncovered).toBe(2000);
  });

  it('поступление с более ранней датой, введённое позже, закрывает долг', () => {
    const sale = out(10, 5, 2000, 1);
    const before = runFifo([sale]);
    expect(before.outs.get(10)!.uncovered).toBe(2000);
    const after = runFifo([sale, inn(1, 3, 5000, 5000, 2)]);
    expect(after.outs.get(10)!.takes).toEqual([{ batchKey: 1, qty: 2000, cost: 2000 }]);
    expect(after.batches[0]).toMatchObject({ qtyLeft: 3000, costLeft: 3000 });
  });

  it('поступление позже продажи долг не закрывает', () => {
    const r = runFifo([out(10, 2, 2000, 1), inn(1, 3, 5000, 5000, 2)]);
    expect(r.outs.get(10)!.uncovered).toBe(2000);
    expect(r.batches[0]).toMatchObject({ qtyLeft: 5000, costLeft: 5000 });
  });

  it('перенос продажи на дату после поступления закрывает долг', () => {
    const receipt = inn(1, 3, 5000, 5000, 2);
    expect(runFifo([out(10, 2, 2000, 1), receipt]).outs.get(10)!.uncovered).toBe(2000);
    expect(runFifo([out(10, 4, 2000, 1), receipt]).outs.get(10)!.uncovered).toBe(0);
  });
});

describe('runFifo: изменение прошлого', () => {
  const base = (): FifoEvent[] => [inn(1, 1, 10_000, 1000, 1), inn(2, 5, 10_000, 3000, 2), out(10, 6, 12_000, 3)];

  it('исходное: 10 по 1000 и 2 по 600', () => {
    expect(runFifo(base()).outs.get(10)!.takes).toEqual([
      { batchKey: 1, qty: 10_000, cost: 1000 },
      { batchKey: 2, qty: 2000, cost: 600 },
    ]);
  });

  it('поступление задним числом встаёт в начало и меняет себестоимость последующей продажи', () => {
    const r = runFifo([...base(), inn(3, 0, 4000, 4000, 9)]);
    expect(r.outs.get(10)!.takes).toEqual([
      { batchKey: 3, qty: 4000, cost: 4000 },
      { batchKey: 1, qty: 8000, cost: 800 },
    ]);
  });

  it('изменение суммы закупки первой партии пересчитывает продажу', () => {
    const events = base();
    events[0] = inn(1, 1, 10_000, 2000, 1);
    expect(runFifo(events).outs.get(10)!.takes[0]).toEqual({ batchKey: 1, qty: 10_000, cost: 2000 });
  });

  it('удаление поступления, из которого уже продавали: продажа остаётся без партии', () => {
    const events = base().filter((e) => e.key !== 1);
    const r = runFifo(events);
    expect(r.outs.get(10)!.takes).toEqual([
      { batchKey: 2, qty: 10_000, cost: 3000 },
      { batchKey: null, qty: 2000, cost: null },
    ]);
    expect(r.outs.get(10)!.uncovered).toBe(2000);
  });

  it('порядок входа не влияет на результат', () => {
    const events = [...base(), inn(3, 0, 4000, 4000, 9), out(11, 7, 1000, 10)];
    const forward = runFifo(events);
    const backward = runFifo([...events].reverse());
    expect(backward.batches).toEqual(forward.batches);
    expect([...backward.outs.entries()].sort()).toEqual([...forward.outs.entries()].sort());
  });
});

/** Детерминированный генератор (mulberry32): тест воспроизводим по зерну. */
function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

describe('runFifo: свойства на случайных последовательностях (§13)', () => {
  it('стоимость склада + себестоимость взятого = сумма закупок; qty_left ≥ 0; количество сходится', () => {
    for (let seed = 1; seed <= 300; seed++) {
      const rand = rng(seed);
      const n = 1 + Math.floor(rand() * 40);
      const events: FifoEvent[] = [];
      for (let i = 0; i < n; i++) {
        const day = 1 + Math.floor(rand() * 28);
        const qty = (1 + Math.floor(rand() * 9)) * (rand() < 0.5 ? 1000 : 1) * (1 + Math.floor(rand() * 5));
        if (rand() < 0.45) events.push(inn(i + 1, day, qty, Math.floor(rand() * 100_000), i + 1));
        else events.push(out(i + 1, day, qty, i + 1));
      }
      const r = runFifo(events);
      const t = fifoTotals(r);
      const purchased = events.filter((e): e is FifoIn => e.kind === 'in');
      const sold = events.filter((e) => e.kind === 'out');

      expect(r.batches.every((b) => b.qtyLeft >= 0 && b.costLeft >= 0), `seed ${seed}`).toBe(true);
      expect(r.batches.every((b) => b.qtyLeft > 0 || b.costLeft === 0), `seed ${seed}: пустая партия без остатка стоимости`).toBe(true);
      expect(t.costLeft + t.costTaken, `seed ${seed}: деньги`).toBe(purchased.reduce((s, e) => s + e.cost, 0));
      expect(t.qtyLeft + t.qtyTaken, `seed ${seed}: количество`).toBe(purchased.reduce((s, e) => s + e.qty, 0));
      expect(t.qtyTaken + t.uncovered, `seed ${seed}: списано`).toBe(sold.reduce((s, e) => s + e.qty, 0));
      // у каждого списания части в сумме дают его количество, а пустая партия всегда с пустой стоимостью
      for (const e of sold) {
        const o = r.outs.get(e.key)!;
        expect(o.takes.reduce((s, x) => s + x.qty, 0)).toBe(e.qty);
        expect(o.takes.every((x) => (x.batchKey === null) === (x.cost === null))).toBe(true);
        expect(o.uncovered).toBe(o.takes.filter((x) => x.batchKey === null).reduce((s, x) => s + x.qty, 0));
      }
      // порядок входа не важен
      expect(runFifo([...events].reverse()).batches, `seed ${seed}: порядок`).toEqual(r.batches);
    }
  });
});

// ---- многоскладское ядро (план Склад-2, задача 1)

const day = (d: number) => `2026-10-${String(d).padStart(2, '0')}T10:00:00.000Z`;
/** События склада: docId по умолчанию — номер ключа, чтобы порядок внутри одного дня был предсказуем. */
const sIn = (wh: number, key: number, d: number, qty: number, cost: number, docId = key): StockEvent => ({ kind: 'in', wh, key, at: day(d), docId, position: 0, qty, cost });
const sOut = (wh: number, key: number, d: number, qty: number, docId = key): StockEvent => ({ kind: 'out', wh, key, at: day(d), docId, position: 0, qty });
const sMove = (wh: number, to: number, key: number, d: number, qty: number, docId = key): StockEvent => ({ kind: 'move', wh, to, key, at: day(d), docId, position: 0, qty });
const sSurplus = (wh: number, key: number, d: number, qty: number, docId = key): StockEvent => ({ kind: 'surplus', wh, key, at: day(d), docId, position: 0, qty });

const left = (r: StockResult, wh: number) =>
  r.batches.filter((b) => b.wh === wh).reduce((s, b) => ({ qty: s.qty + b.qtyLeft, cost: s.cost + b.costLeft }), { qty: 0, cost: 0 });

describe('runStock (§5.2, Склад-2)', () => {
  it('перемещение берёт партии отправителя по FIFO и создаёт у получателя партии той же стоимости', () => {
    const r = runStock([sIn(1, 1, 1, 2000, 200), sIn(1, 2, 2, 3000, 360), sMove(1, 2, 3, 3, 4000)]);
    expect(
      r.batches.filter((b) => b.wh === 2).map(({ wh, originKey, qtyIn, costIn, sourceIndex, qtyLeft, costLeft }) => ({ wh, originKey, qtyIn, costIn, sourceIndex, qtyLeft, costLeft })),
    ).toEqual([
      { wh: 2, originKey: 3, qtyIn: 2000, costIn: 200, sourceIndex: 0, qtyLeft: 2000, costLeft: 200 },
      { wh: 2, originKey: 3, qtyIn: 2000, costIn: 240, sourceIndex: 1, qtyLeft: 2000, costLeft: 240 },
    ]);
    expect(r.batches[1]).toMatchObject({ wh: 1, originKey: 2, qtyLeft: 1000, costLeft: 120 });
    expect(r.outs.get(3)).toMatchObject({ key: 3, wh: 1, kind: 'move', uncovered: 0, available: 5000 });
    expect(r.outs.get(3)!.takes).toEqual([
      { batchIndex: 0, qty: 2000, cost: 200 },
      { batchIndex: 1, qty: 2000, cost: 240 },
    ]);
  });

  it('перемещение туда и обратно: себестоимость продажи и остатки сходятся', () => {
    const r = runStock([sIn(1, 1, 1, 10_000, 1000), sMove(1, 2, 2, 2, 4000), sMove(2, 1, 3, 3, 1000), sOut(1, 4, 4, 7000)]);
    const sale = r.outs.get(4)!;
    expect(sale.uncovered).toBe(0);
    expect(sale.takes.reduce((s, t) => s + (t.cost ?? 0), 0)).toBe(700);
    expect(left(r, 2)).toEqual({ qty: 3000, cost: 300 });
    expect(left(r, 1)).toEqual({ qty: 0, cost: 0 });
    expect(r.batches.reduce((s, b) => s + b.costLeft, 0)).toBe(1000 - 700);
    // вернувшаяся единица — партия Клуба 1 с источником в партии Клуба 2
    const back = r.batches.find((b) => b.wh === 1 && b.originKey === 3)!;
    expect(r.batches[back.sourceIndex!]).toMatchObject({ wh: 2, originKey: 2 });
  });

  it('перемещение без остатка оставляет непокрытое и не создаёт партий получателю', () => {
    const r = runStock([sMove(1, 2, 1, 1, 1000)]);
    expect(r.outs.get(1)).toMatchObject({ uncovered: 1000, available: 0 });
    expect(r.outs.get(1)!.takes).toEqual([{ batchIndex: null, qty: 1000, cost: null }]);
    expect(r.batches).toEqual([]);
  });

  it('излишек — по цене последней партии склада; без партий — 0 и unknownCost', () => {
    const r = runStock([sIn(1, 1, 1, 3000, 360), sSurplus(1, 2, 2, 2000), sSurplus(2, 3, 3, 1000)]);
    expect(r.batches.find((b) => b.originKey === 2)).toMatchObject({ wh: 1, qtyIn: 2000, costIn: 240, unknownCost: false, sourceIndex: null });
    expect(r.batches.find((b) => b.originKey === 3)).toMatchObject({ wh: 2, qtyIn: 1000, costIn: 0, unknownCost: true });
  });

  it('излишек берёт цену последней созданной партии склада — и партии перемещения', () => {
    const r = runStock([sIn(1, 1, 1, 1000, 100), sIn(2, 2, 2, 1000, 500), sMove(2, 1, 3, 3, 1000), sSurplus(1, 4, 4, 2000)]);
    expect(r.batches.find((b) => b.originKey === 4)).toMatchObject({ costIn: 1000, unknownCost: false });
  });

  it('перемещение партии без цены даёт получателю партию без цены', () => {
    const r = runStock([sSurplus(1, 1, 1, 2000), sMove(1, 2, 2, 2, 1000)]);
    expect(r.batches.find((b) => b.wh === 2)).toMatchObject({ originKey: 2, qtyIn: 1000, costIn: 0, unknownCost: true, sourceIndex: 0 });
  });

  it('приход нулевого количества партии не создаёт и не ломает цену следующего излишка', () => {
    const r = runStock([sIn(1, 1, 1, 1000, 300), sSurplus(1, 2, 2, 0), sSurplus(1, 3, 3, 1000)]);
    expect(r.batches.map((b) => [b.originKey, b.costIn])).toEqual([
      [1, 300],
      [3, 300],
    ]);
  });

  it('излишек после излишка без цены — тоже без цены', () => {
    const r = runStock([sSurplus(1, 1, 1, 1000), sSurplus(1, 2, 2, 1000)]);
    expect(r.batches.map((b) => [b.costIn, b.unknownCost])).toEqual([
      [0, true],
      [0, true],
    ]);
  });

  it('продажа на складе-получателе берёт партии перемещения, нехватка — без партии', () => {
    const r = runStock([sIn(1, 1, 1, 10_000, 100_000), sMove(1, 2, 2, 2, 4000), sOut(2, 3, 3, 5000)]);
    expect(r.outs.get(3)!.takes).toEqual([
      { batchIndex: 1, qty: 4000, cost: 40_000 },
      { batchIndex: null, qty: 1000, cost: null },
    ]);
    expect(r.outs.get(3)).toMatchObject({ kind: 'out', wh: 2, available: 4000, uncovered: 1000 });
  });

  it('qtyAt считает события строго раньше момента', () => {
    const events = [sIn(1, 1, 1, 5000, 500), sMove(1, 2, 2, 2, 1000), sOut(1, 3, 3, 7000), sSurplus(2, 4, 4, 500)];
    const after = { at: day(5), docId: 0, position: 0 };
    expect(qtyAt(events, 1, after)).toBe(-3000);
    expect(qtyAt(events, 2, after)).toBe(1500);
    // сам момент события не входит; тот же момент и документ с меньшей позицией — входит
    expect(qtyAt(events, 1, { at: day(3), docId: 3, position: 0 })).toBe(4000);
    expect(qtyAt([sIn(1, 1, 1, 1000, 0, 7), { ...sIn(1, 2, 1, 2000, 0, 7), position: 1 }], 1, { at: day(1), docId: 7, position: 1 })).toBe(1000);
  });

  it('batchQtyAt — остаток партий склада перед моментом, без долга «Нет партии»', () => {
    // поступление 10, продажа 12: партий 0, долг 2 (qtyAt даёт −2)
    const events = [sIn(1, 1, 1, 10_000, 1000), sOut(1, 2, 2, 12_000)];
    const after = { at: day(5), docId: 0, position: 0 };
    expect(qtyAt(events, 1, after)).toBe(-2000);
    expect(batchQtyAt(events, 1, after)).toBe(0);
    // продажа без партии раньше поступления: долг остаётся, а партия поступления цела
    const late = [sOut(1, 1, 1, 2000), sIn(1, 2, 2, 3000, 300), sMove(1, 2, 3, 3, 1000)];
    expect(batchQtyAt(late, 1, after)).toBe(2000);
    expect(batchQtyAt(late, 2, after)).toBe(1000);
    // событие в сам момент не входит
    expect(batchQtyAt(late, 1, { at: day(2), docId: 2, position: 0 })).toBe(0);
  });

  it('runFifo совпадает с runStock на одном складе', () => {
    const events: FifoEvent[] = [inn(1, 1, 10_000, 1000, 1), inn(2, 5, 10_000, 3000, 2), out(10, 6, 12_000, 3), out(11, 7, 9000, 4)];
    const fifo = runFifo(events);
    const stock = runStock(events.map((e) => ({ ...e, wh: 0 })));
    expect(fifo.batches.map((b) => [b.key, b.qtyLeft, b.costLeft])).toEqual(stock.batches.map((b) => [b.originKey, b.qtyLeft, b.costLeft]));
    for (const k of [10, 11]) {
      expect(fifo.outs.get(k)!.takes.map((t) => [t.batchKey, t.qty, t.cost])).toEqual(
        stock.outs.get(k)!.takes.map((t) => [t.batchIndex === null ? null : stock.batches[t.batchIndex]!.originKey, t.qty, t.cost]),
      );
    }
  });

  it('свойства на случайных последовательностях: деньги и количество сходятся, порядок входа не важен', () => {
    for (let seed = 1; seed <= 200; seed++) {
      const rand = rng(seed * 7919);
      const n = 1 + Math.floor(rand() * 50);
      const events: StockEvent[] = [];
      for (let i = 0; i < n; i++) {
        const d = 1 + Math.floor(rand() * 28);
        const wh = 1 + Math.floor(rand() * 3);
        const qty = (1 + Math.floor(rand() * 9)) * (rand() < 0.5 ? 1000 : 1);
        const p = rand();
        if (p < 0.35) events.push(sIn(wh, i + 1, d, qty, Math.floor(rand() * 100_000)));
        else if (p < 0.6) events.push(sOut(wh, i + 1, d, qty));
        else if (p < 0.85) events.push(sMove(wh, 1 + ((wh + Math.floor(rand() * 2)) % 3), i + 1, d, qty));
        else events.push(sSurplus(wh, i + 1, d, qty));
      }
      const r = runStock(events);
      const kindOf = new Map(events.map((e) => [e.key, e.kind]));
      const ins = events.reduce((s, e) => s + (e.kind === 'in' ? e.cost : 0), 0);
      const surplus = r.batches.filter((b) => kindOf.get(b.originKey) === 'surplus').reduce((s, b) => s + b.costIn, 0);
      let taken = 0;
      for (const o of r.outs.values()) if (o.kind === 'out') taken += o.takes.reduce((s, t) => s + (t.cost ?? 0), 0);
      const costLeft = r.batches.reduce((s, b) => s + b.costLeft, 0);

      expect(costLeft + taken, `seed ${seed}: деньги`).toBe(ins + surplus);
      expect(
        r.batches.every((b) => b.qtyLeft >= 0 && b.costLeft >= 0),
        `seed ${seed}: остатки не отрицательны`,
      ).toBe(true);
      for (const o of r.outs.values()) {
        const e = events.find((x) => x.key === o.key)!;
        expect(o.takes.reduce((s, t) => s + t.qty, 0), `seed ${seed}: части списания`).toBe(e.qty);
        expect(o.uncovered).toBe(o.takes.filter((t) => t.batchIndex === null).reduce((s, t) => s + t.qty, 0));
      }
      // перемещение: партии получателя повторяют покрытые взятия
      for (const o of r.outs.values()) {
        if (o.kind !== 'move') continue;
        const made = r.batches.filter((b) => b.originKey === o.key && b.sourceIndex !== null);
        expect(
          made.map((b) => [b.sourceIndex, b.qtyIn, b.costIn]),
          `seed ${seed}: партии перемещения`,
        ).toEqual(o.takes.filter((t) => t.batchIndex !== null).map((t) => [t.batchIndex, t.qty, t.cost]));
      }
      expect(runStock([...events].reverse()).batches, `seed ${seed}: порядок`).toEqual(r.batches);
    }
  });
});
