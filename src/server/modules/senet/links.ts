import { and, eq, isNotNull, ne } from 'drizzle-orm';
import type { Executor } from '../../db/client';
import { first } from '../../db/raw';
import { senetCashMoves, senetPostings } from '../../db/schema';
import { AppError } from '../../errors';

export interface SenetLink {
  shiftId: number;
  kind: 'move' | 'kaspi' | 'cash';
  noRepost: boolean;
}

/** Откуда операция: выемка смены или доход смены Senet; null — операция не из Senet. */
export async function senetLinkOf(ex: Executor, operationId: number): Promise<SenetLink | null> {
  const move = await first(ex.select({ shiftId: senetCashMoves.shiftId, noRepost: senetCashMoves.noRepost }).from(senetCashMoves).where(eq(senetCashMoves.operationId, operationId)));
  if (move) return { shiftId: move.shiftId, kind: 'move', noRepost: move.noRepost };
  const posting = await first(ex.select({ shiftId: senetPostings.shiftId, kind: senetPostings.kind, noRepost: senetPostings.noRepost }).from(senetPostings).where(eq(senetPostings.operationId, operationId)));
  return posting ? { shiftId: posting.shiftId, kind: posting.kind, noRepost: posting.noRepost } : null;
}

/**
 * «Отмена» удаления операции Senet (§5.3, П3): если модуль уже провёл выемку или доход заново другой операцией,
 * восстановить старую нельзя — иначе деньги окажутся в журнале дважды.
 */
export async function assertSenetRestorable(ex: Executor, operationId: number): Promise<void> {
  const replaced =
    (await first(
      ex
        .select({ id: senetCashMoves.id })
        .from(senetCashMoves)
        .where(and(eq(senetCashMoves.prevOperationId, operationId), isNotNull(senetCashMoves.operationId), ne(senetCashMoves.operationId, operationId))),
    )) ??
    (await first(
      ex
        .select({ id: senetPostings.id })
        .from(senetPostings)
        .where(and(eq(senetPostings.prevOperationId, operationId), isNotNull(senetPostings.operationId), ne(senetPostings.operationId, operationId))),
    ));
  if (replaced) throw new AppError(409, 'SENET_REPLACED', 'Senet уже провёл эту выемку заново — удалите новую операцию');
}
