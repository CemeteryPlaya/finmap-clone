import { describe, expect, it } from 'vitest';
import { compareMoment, fifoTotals, runFifo, takeCost, type FifoEvent, type FifoIn, type FifoOut } from '../../src/shared/stock-fifo';

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
