import { and, asc, desc, eq, inArray, isNull } from 'drizzle-orm';
import type { Executor } from '../../db/client';
import { categories, counterparties, operationLines, operations, senetCashMoves, senetConnections, senetOffices, senetShifts } from '../../db/schema';
import type { Hint } from './posting/classify';
import { normalize } from './posting/normalize';

export interface Suggestion {
  categoryId: number;
  counterpartyId: number | null;
  label: string;
}

const DAY = 86_400_000;
const HISTORY = 2000;
/** Слово короче трёх букв («то», «на») похожести не даёт. */
const MIN_WORD = 3;

/**
 * 2–3 предложения пункта очереди (§6.3): подсказка правила; самая частая пара «категория, контрагент» у проведённых
 * выемок с общими словами; самая частая пара у выемок той же суммы за 30 дней. Без повторов, не больше трёх.
 */
export async function suggest(ex: Executor, item: { companyId: number; comment: string; amount: number; at: string; hint: Hint | null }): Promise<Suggestion[]> {
  const history = await ex
    .select({ comment: senetCashMoves.comment, amount: senetCashMoves.amount, at: senetCashMoves.at, categoryId: operationLines.categoryId, counterpartyId: operations.counterpartyId })
    .from(senetCashMoves)
    .innerJoin(senetShifts, eq(senetShifts.id, senetCashMoves.shiftId))
    .innerJoin(senetOffices, eq(senetOffices.id, senetShifts.officeId))
    .innerJoin(senetConnections, eq(senetConnections.id, senetOffices.connectionId))
    .innerJoin(operations, eq(operations.id, senetCashMoves.operationId))
    .innerJoin(operationLines, and(eq(operationLines.operationId, operations.id), eq(operationLines.position, 0)))
    .where(and(eq(senetConnections.companyId, item.companyId), isNull(operations.deletedAt)))
    .orderBy(desc(senetCashMoves.at))
    .limit(HISTORY);

  const out: { categoryId: number; counterpartyId: number | null }[] = [];
  const add = (p: { categoryId: number | null; counterpartyId: number | null } | null) => {
    if (!p || p.categoryId === null || out.some((x) => x.categoryId === p.categoryId && x.counterpartyId === p.counterpartyId)) return;
    out.push({ categoryId: p.categoryId, counterpartyId: p.counterpartyId });
  };
  /** Самая частая пара; при равенстве — та, что встретилась раньше (свежее). */
  const top = (rows: typeof history) => {
    const count = new Map<string, { categoryId: number | null; counterpartyId: number | null; n: number }>();
    for (const r of rows) {
      const k = `${r.categoryId}|${r.counterpartyId}`;
      const c = count.get(k) ?? { categoryId: r.categoryId, counterpartyId: r.counterpartyId, n: 0 };
      c.n++;
      count.set(k, c);
    }
    return [...count.values()].sort((a, b) => b.n - a.n)[0] ?? null;
  };

  if (item.hint?.categoryId) add({ categoryId: item.hint.categoryId, counterpartyId: item.hint.counterpartyId ?? null });
  const words = new Set(normalize(item.comment).split(' ').filter((w) => w.length >= MIN_WORD));
  if (words.size) add(top(history.filter((h) => normalize(h.comment).split(' ').some((w) => words.has(w)))));
  const since = new Date(Date.parse(item.at) - 30 * DAY).toISOString();
  add(top(history.filter((h) => h.amount === item.amount && h.at >= since)));

  const list = out.slice(0, 3);
  const catIds = list.map((x) => x.categoryId);
  const cpIds = list.map((x) => x.counterpartyId).filter((x): x is number => x !== null);
  const catNames = new Map((catIds.length ? await ex.select({ id: categories.id, name: categories.name }).from(categories).where(inArray(categories.id, catIds)).orderBy(asc(categories.id)) : []).map((c) => [c.id, c.name]));
  const cpNames = new Map((cpIds.length ? await ex.select({ id: counterparties.id, name: counterparties.name }).from(counterparties).where(inArray(counterparties.id, cpIds)) : []).map((c) => [c.id, c.name]));
  return list.map((x) => ({ ...x, label: [catNames.get(x.categoryId), x.counterpartyId !== null ? cpNames.get(x.counterpartyId) : null].filter(Boolean).join(' · ') }));
}
