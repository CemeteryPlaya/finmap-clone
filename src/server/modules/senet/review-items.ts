import { and, eq, inArray, isNull } from 'drizzle-orm';
import type { Executor } from '../../db/client';
import { operations, senetCashMoves, senetReviewItems, senetShifts } from '../../db/schema';
import type { ShiftPlan } from './posting/plan';
import { suggest } from './suggest';

type Shift = typeof senetShifts.$inferSelect;
type Move = typeof senetCashMoves.$inferSelect;

export const openKey = (shiftId: number, moveId: number | null, reason: string) => `${shiftId}|${moveId ?? 0}|${reason}`;

/**
 * Пункты очереди смены по плану (§6.2): новые — с предложениями; открытые, которых план больше не просит (выемку
 * провели, правило появилось), закрываются сами. Выемка — один открытый пункт на причину; пропущенная («Не проводить
 * повторно») пункта не получает. Пункт дохода (нет kaspi, касса < 0) создаётся один раз за смену.
 */
export async function syncReviewItems(tx: Executor, o: { companyId: number; shift: Shift; plan: ShiftPlan; moves: readonly Move[]; at: string }): Promise<number> {
  const ids = o.moves.map((m) => m.id);
  const fresh = new Map((ids.length ? await tx.select().from(senetCashMoves).where(inArray(senetCashMoves.id, ids)) : []).map((m) => [m.id, m]));
  const opIds = [...fresh.values()].map((m) => m.operationId).filter((x): x is number => x !== null);
  const live = new Set((opIds.length ? await tx.select({ id: operations.id }).from(operations).where(and(inArray(operations.id, opIds), isNull(operations.deletedAt))) : []).map((r) => r.id));

  const existing = await tx.select().from(senetReviewItems).where(eq(senetReviewItems.shiftId, o.shift.id));
  const wanted = new Map<string, { moveId: number | null; reason: (typeof senetReviewItems.$inferInsert)['reason']; hint: object | null; move: Move | null }>();
  for (const r of o.plan.reviews) {
    if (r.moveIndex === null) {
      // доход смены: один раз — ответ (или пропуск) не возвращается
      if (existing.some((e) => e.cashMoveId === null && e.reason === r.reason && e.status !== 'open')) continue;
      wanted.set(openKey(o.shift.id, null, r.reason), { moveId: null, reason: r.reason, hint: r.hint, move: null });
      continue;
    }
    const m = fresh.get(o.moves[r.moveIndex]!.id)!;
    if (m.noRepost || (m.operationId !== null && live.has(m.operationId))) continue;
    wanted.set(openKey(o.shift.id, m.id, r.reason), { moveId: m.id, reason: r.reason, hint: r.hint, move: m });
  }

  for (const e of existing) {
    if (e.status !== 'open' || wanted.has(e.openKey!)) continue;
    await tx
      .update(senetReviewItems)
      .set({ status: 'answered', openKey: null, answer: JSON.stringify({ auto: true }), answeredAt: o.at })
      .where(eq(senetReviewItems.id, e.id));
  }
  let created = 0;
  for (const [key, w] of wanted) {
    if (existing.some((e) => e.openKey === key)) continue;
    const suggestions = w.move ? await suggest(tx, { companyId: o.companyId, comment: w.move.comment, amount: w.move.amount, at: w.move.at, hint: w.hint }) : [];
    await tx.insert(senetReviewItems).values({ shiftId: o.shift.id, cashMoveId: w.moveId, reason: w.reason, suggestions: JSON.stringify(suggestions), openKey: key, createdAt: o.at });
    created++;
  }
  return created;
}
