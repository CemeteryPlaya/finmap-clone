import { afterEach, describe, expect, it } from 'vitest';
import { runStock, type StockEvent } from '../../src/shared/stock-fifo';
import { stockWorld, type StockWorld } from '../helpers/stock';

let w: StockWorld | null = null;
afterEach(async () => {
  await w?.h.t.cleanup();
  w = null;
});

/** Детерминированный генератор (mulberry32): последовательность воспроизводится по зерну. */
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

interface Counts {
  n: number;
}

/** Число строк в таблицах, которые пробный расчёт (`dryRun`) не должен менять. */
function rowCounts(world: StockWorld): Record<string, number> {
  const s = world.h.t.sqlite;
  const out: Record<string, number> = {};
  for (const table of ['stock_docs', 'stock_batches', 'stock_allocations', 'audit_log']) {
    out[table] = (s.prepare(`SELECT COUNT(*) n FROM ${table}`).get() as Counts).n;
  }
  return out;
}

/** Инварианты §13: деньги и количество сходятся, остатки не отрицательны, база равна свежему пересчёту. */
function assertInvariants(world: StockWorld, label: string): void {
  const s = world.h.t.sqlite;
  const one = <T>(sql: string) => s.prepare(sql).get() as T;
  const purchased = one<{ v: number }>(
    "SELECT COALESCE(SUM(l.amount), 0) v FROM stock_doc_lines l JOIN stock_docs d ON d.id = l.doc_id WHERE d.type = 'receipt' AND d.deleted_at IS NULL",
  ).v;
  const left = one<{ v: number }>('SELECT COALESCE(SUM(cost_left), 0) v FROM stock_batches').v;
  // взятое перемещением не уходит со склада — оно стало партиями получателя
  const taken = one<{ v: number }>(
    "SELECT COALESCE(SUM(a.cost), 0) v FROM stock_allocations a JOIN stock_doc_lines l ON l.id = a.line_id JOIN stock_docs d ON d.id = l.doc_id WHERE d.type <> 'transfer'",
  ).v;
  expect(left + taken, `${label}: стоимость склада + себестоимость = закупки`).toBe(purchased);

  const qtyIn = one<{ v: number }>('SELECT COALESCE(SUM(qty_in), 0) v FROM stock_batches').v;
  const qtyLeft = one<{ v: number }>('SELECT COALESCE(SUM(qty_left), 0) v FROM stock_batches').v;
  const qtyTaken = one<{ v: number }>('SELECT COALESCE(SUM(qty), 0) v FROM stock_allocations WHERE batch_id IS NOT NULL').v;
  expect(qtyLeft + qtyTaken, `${label}: количество`).toBe(qtyIn);
  expect(one<Counts>('SELECT COUNT(*) n FROM stock_batches WHERE qty_left < 0 OR cost_left < 0 OR (qty_left = 0 AND cost_left <> 0)').n, `${label}: отрицательные остатки`).toBe(0);

  // у каждой живой строки списания части дают её количество, у удалённых документов нет ни партий, ни списаний
  const bad = s
    .prepare(
      `SELECT l.id FROM stock_doc_lines l JOIN stock_docs d ON d.id = l.doc_id
        WHERE d.type IN ('sale', 'writeoff', 'transfer') AND d.deleted_at IS NULL
          AND l.qty <> (SELECT COALESCE(SUM(a.qty), 0) FROM stock_allocations a WHERE a.line_id = l.id)`,
    )
    .all();
  expect(bad, `${label}: части списания`).toEqual([]);
  expect(
    one<Counts>(
      `SELECT COUNT(*) n FROM stock_batches b JOIN stock_doc_lines l ON l.id = b.origin_line_id JOIN stock_docs d ON d.id = l.doc_id WHERE d.deleted_at IS NOT NULL`,
    ).n,
    `${label}: партии удалённых`,
  ).toBe(0);
  expect(
    one<Counts>(
      `SELECT COUNT(*) n FROM stock_allocations a JOIN stock_doc_lines l ON l.id = a.line_id JOIN stock_docs d ON d.id = l.doc_id WHERE d.deleted_at IS NOT NULL`,
    ).n,
    `${label}: списания удалённых`,
  ).toBe(0);

  // база равна независимому пересчёту по живым документам
  const lines = s
    .prepare(
      `SELECT l.id lineId, l.doc_id docId, l.position position, l.qty qty, l.amount amount, l.item_id itemId, d.warehouse_id warehouseId, d.to_warehouse_id toWarehouseId, d.type type, d.at at
         FROM stock_doc_lines l JOIN stock_docs d ON d.id = l.doc_id WHERE d.deleted_at IS NULL`,
    )
    .all() as { lineId: number; docId: number; position: number; qty: number; amount: number | null; itemId: number; warehouseId: number; toWarehouseId: number | null; type: string; at: string }[];
  // все склады товара — одним проходом: группы пересчёта независимы, их объединение даёт тот же результат
  const byItem = new Map<number, StockEvent[]>();
  for (const l of lines) {
    const base = { key: l.lineId, at: l.at, docId: l.docId, position: l.position, qty: l.qty, wh: l.warehouseId };
    const ev: StockEvent =
      l.type === 'receipt' ? { ...base, kind: 'in', cost: l.amount ?? 0 } : l.type === 'transfer' ? { ...base, kind: 'move', to: l.toWarehouseId! } : { ...base, kind: 'out' };
    byItem.set(l.itemId, [...(byItem.get(l.itemId) ?? []), ev]);
  }
  for (const [item, events] of byItem) {
    const fresh = runStock(events);
    for (const o of fresh.outs.values()) {
      const stored = s.prepare('SELECT COALESCE(SUM(cost), 0) cost, COALESCE(SUM(CASE WHEN batch_id IS NULL THEN qty END), 0) unc FROM stock_allocations WHERE line_id = ?').get(o.key) as { cost: number; unc: number };
      expect([stored.cost, stored.unc], `${label}: строка ${o.key} товара ${item}`).toEqual([o.takes.reduce((a, t) => a + (t.cost ?? 0), 0), o.uncovered]);
    }
    for (const wh of new Set(fresh.batches.map((b) => b.wh).concat(events.map((e) => e.wh)))) {
      const storedLeft = s.prepare('SELECT COALESCE(SUM(qty_left), 0) q, COALESCE(SUM(cost_left), 0) c FROM stock_batches WHERE warehouse_id = ? AND item_id = ?').get(wh, item) as { q: number; c: number };
      const mine = fresh.batches.filter((b) => b.wh === wh);
      expect([storedLeft.q, storedLeft.c], `${label}: остаток склада ${wh} товара ${item}`).toEqual([mine.reduce((a, b) => a + b.qtyLeft, 0), mine.reduce((a, b) => a + b.costLeft, 0)]);
    }
  }
}

describe('случайные последовательности документов (§13)', () => {
  it('после любой последовательности создания, правки и удаления инварианты FIFO сохраняются', async () => {
    let insufficient = 0;
    for (const seed of [11, 22, 33, 44]) {
      const world = await stockWorld('2026-10-06T12:00:00.000Z');
      w = world;
      const rand = rng(seed);
      const pick = <T>(list: T[]): T => list[Math.floor(rand() * list.length)]!;
      const items = [world.cola, world.chips];
      const warehouses = [world.wh, world.wh2];
      // перемещение: со случайного склада на другой
      const route = () => {
        const from = pick(warehouses);
        return { warehouseId: from, toWarehouseId: warehouses.find((x) => x !== from)! };
      };
      const at = () => `2026-10-0${1 + Math.floor(rand() * 5)}T${String(8 + Math.floor(rand() * 10)).padStart(2, '0')}:00:00.000Z`;
      const lines = (withAmount: boolean) =>
        Array.from({ length: 1 + Math.floor(rand() * 3) }, () => ({
          itemId: pick(items),
          qty: (1 + Math.floor(rand() * 6)) * 1000,
          ...(withAmount ? { amount: Math.floor(rand() * 50_000) } : {}),
        }));
      const live: { id: number; version: number; type: string }[] = [];
      let saved = 0;
      let probes = 0;
      for (let step = 0; step < 45; step++) {
        const roll = rand();
        let res;
        const label = `seed ${seed} шаг ${step}`;
        // пробный расчёт перед шагом: ни документов, ни партий, ни списаний, ни истории не прибавляется и не убывает
        if (rand() < 0.35) {
          const counts = rowCounts(world);
          const kind = live.length > 0 ? pick(['create', 'patch', 'delete']) : 'create';
          let probe;
          if (kind === 'create') {
            const type = pick(['receipt', 'sale', 'writeoff', 'transfer']);
            probe = await world.h.req('POST', `${world.stock}/docs`, {
              type,
              at: at(),
              ...(type === 'transfer' ? route() : { warehouseId: pick(warehouses) }),
              ...(type === 'writeoff' ? { reason: 'defect' } : {}),
              lines: lines(type === 'receipt' || type === 'sale'),
              dryRun: true,
            });
          } else if (kind === 'patch') {
            const doc = pick(live);
            probe = await world.h.req('PATCH', `${world.stock}/docs/${doc.id}`, { version: doc.version, at: at(), ...(doc.type === 'transfer' ? {} : { warehouseId: pick(warehouses) }), lines: lines(doc.type === 'receipt' || doc.type === 'sale'), dryRun: true });
          } else {
            const doc = pick(live);
            probe = await world.h.req('DELETE', `${world.stock}/docs/${doc.id}?dryRun=1`);
          }
          expect([200, 422], `${label}: dryRun ${kind}: ${probe.body}`).toContain(probe.statusCode);
          if (probe.statusCode === 200) expect(probe.json().doc, `${label}: dryRun без документа`).toBeNull();
          expect(rowCounts(world), `${label}: dryRun ${kind} ничего не записал`).toEqual(counts);
          probes++;
        }
        if (roll < 0.3) {
          res = await world.h.req('POST', `${world.stock}/docs`, { type: 'receipt', at: at(), warehouseId: pick(warehouses), lines: lines(true) });
          if (res.statusCode === 201) live.push({ ...(res.json().doc as { id: number; version: number }), type: 'receipt' });
        } else if (roll < 0.5) {
          res = await world.h.req('POST', `${world.stock}/docs`, { type: 'sale', at: at(), warehouseId: pick(warehouses), lines: lines(true) });
          if (res.statusCode === 201) live.push({ ...(res.json().doc as { id: number; version: number }), type: 'sale' });
        } else if (roll < 0.6) {
          res = await world.h.req('POST', `${world.stock}/docs`, { type: 'writeoff', at: at(), warehouseId: pick(warehouses), reason: 'defect', lines: lines(false) });
          if (res.statusCode === 201) live.push({ ...(res.json().doc as { id: number; version: number }), type: 'writeoff' });
        } else if (roll < 0.75) {
          res = await world.h.req('POST', `${world.stock}/docs`, { type: 'transfer', at: at(), ...route(), lines: lines(false) });
          if (res.statusCode === 201) live.push({ ...(res.json().doc as { id: number; version: number }), type: 'transfer' });
        } else if (live.length > 0 && roll < 0.9) {
          const doc = pick(live);
          const withAmount = doc.type === 'receipt' || doc.type === 'sale';
          // иногда документ переезжает на другой склад
          const move = doc.type !== 'transfer' && rand() < 0.3 ? { warehouseId: pick(warehouses) } : {};
          res = await world.h.req('PATCH', `${world.stock}/docs/${doc.id}`, { version: doc.version, at: at(), ...move, lines: lines(withAmount) });
          if (res.statusCode === 200) doc.version += 1;
        } else if (live.length > 0) {
          const doc = pick(live);
          res = await world.h.req('DELETE', `${world.stock}/docs/${doc.id}`);
          if (res.statusCode === 200) live.splice(live.indexOf(doc), 1);
        } else continue;
        expect([200, 201, 422], `${label}: ${res.body}`).toContain(res.statusCode);
        if (res.statusCode !== 422) saved++;
        if (res.statusCode === 422) {
          expect(res.json().error.code, label).toBe('INSUFFICIENT_STOCK');
          insufficient++;
        }
        assertInvariants(world, label);
      }
      expect(saved, `seed ${seed}: последовательность не пустая`).toBeGreaterThan(20);
      expect(probes, `seed ${seed}: пробные расчёты были`).toBeGreaterThan(0);
      await world.h.t.cleanup();
      w = null;
    }
    expect(insufficient, 'INSUFFICIENT_STOCK сработал хотя бы раз за весь прогон').toBeGreaterThan(0);
  }, 120_000);
});
