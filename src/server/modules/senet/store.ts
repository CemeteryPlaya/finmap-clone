import { and, asc, eq, gte, inArray, lt, sql } from 'drizzle-orm';
import type { Executor } from '../../db/client';
import { first } from '../../db/raw';
import { senetCashMoves, senetShifts, senetTransactions } from '../../db/schema';
import { normalize } from './posting/normalize';
import { shiftTotals, shiftWindows } from './posting/windows';
import type { CashMoveRow, SessionRow, TransactionRow } from './source';

/** Разобранные отчёты одного отрезка забора клуба. */
export interface OfficeBatch {
  officeId: number;
  sessions: SessionRow[];
  moves: CashMoveRow[];
  /** Окно запроса выемок: выемка из этого окна, которой нет в ответе, — «исчезла из Senet». */
  movesFrom: string;
  movesTo: string;
  /** null — отчёт транзакций не пришёл: строки и контроль выручки не трогаются. */
  transactions: TransactionRow[] | null;
  txFrom: string;
  txTo: string;
}

const CHUNK = 500;

/** Ключ выемки (П6): `{at}|{amount}|{нормализованный комментарий}|{n}`, n — номер повтора одинаковых строк смены. */
function withRefs<M extends CashMoveRow>(moves: readonly M[]): (M & { senetRef: string })[] {
  const seen = new Map<string, number>();
  return moves.map((m) => {
    const base = `${m.at}|${m.amount}|${normalize(m.comment)}`;
    const n = (seen.get(base) ?? 0) + 1;
    seen.set(base, n);
    return { ...m, senetRef: `${base}|${n}` };
  });
}

/**
 * Запись отрезка клуба (§9.1, П5) внутри транзакции вызывающего: смены — по ключу (клуб, начало), выемки — по окнам смен
 * и ключу П6, транзакции — заменой строк окна; затем пересчёт сумм затронутых смен.
 */
export async function writeOfficeBatch(tx: Executor, b: OfficeBatch, at: string): Promise<{ shifts: number; moves: number }> {
  for (const s of b.sessions) {
    const values = {
      closedAt: s.closedAt,
      openedBy: s.openedBy,
      closedBy: s.closedBy,
      endBalance: s.endBalance,
      cashless: s.cashless,
      updatedAt: at,
    };
    await tx
      .insert(senetShifts)
      .values({ officeId: b.officeId, openedAt: s.openedAt, ...values })
      .onConflictDoUpdate({ target: [senetShifts.officeId, senetShifts.openedAt], set: values });
  }

  if (b.transactions) {
    await tx.delete(senetTransactions).where(and(eq(senetTransactions.officeId, b.officeId), gte(senetTransactions.at, b.txFrom), lt(senetTransactions.at, b.txTo)));
    for (let i = 0; i < b.transactions.length; i += CHUNK) {
      await tx.insert(senetTransactions).values(b.transactions.slice(i, i + CHUNK).map((t) => ({ officeId: b.officeId, ...t })));
    }
  }

  const shifts = await tx.select().from(senetShifts).where(eq(senetShifts.officeId, b.officeId)).orderBy(asc(senetShifts.openedAt));
  const touched = new Set<number>(shifts.filter((s) => b.sessions.some((r) => r.openedAt === s.openedAt)).map((s) => s.id));
  const fetched = new Set<string>();
  let moves = 0;
  for (const { shift, moves: own } of shiftWindows(shifts, b.moves)) {
    if (own.length === 0) continue;
    touched.add(shift.id);
    for (const m of withRefs(own)) {
      fetched.add(`${shift.id}|${m.senetRef}`);
      await tx
        .insert(senetCashMoves)
        .values({ shiftId: shift.id, senetRef: m.senetRef, kind: m.kind, amount: m.amount, at: m.at, cashier: m.cashier, comment: m.comment })
        .onConflictDoUpdate({ target: [senetCashMoves.shiftId, senetCashMoves.senetRef], set: { cashier: m.cashier, comment: m.comment, missingInSenet: false } });
      moves++;
    }
  }

  // выемка окна запроса, которой больше нет в ответе Senet, отмечается; операция по ней (если есть) остаётся
  const shiftIds = shifts.map((s) => s.id);
  if (shiftIds.length) {
    const inWindow = await tx
      .select({ id: senetCashMoves.id, shiftId: senetCashMoves.shiftId, senetRef: senetCashMoves.senetRef, missing: senetCashMoves.missingInSenet })
      .from(senetCashMoves)
      .where(and(inArray(senetCashMoves.shiftId, shiftIds), gte(senetCashMoves.at, b.movesFrom), lt(senetCashMoves.at, b.movesTo)));
    const gone = inWindow.filter((m) => !m.missing && !fetched.has(`${m.shiftId}|${m.senetRef}`));
    if (gone.length) {
      await tx
        .update(senetCashMoves)
        .set({ missingInSenet: true })
        .where(inArray(senetCashMoves.id, gone.map((m) => m.id)));
      for (const m of gone) touched.add(m.shiftId);
    }
  }

  for (const shift of shifts.filter((s) => touched.has(s.id))) {
    const own = await tx
      .select({ kind: senetCashMoves.kind, amount: senetCashMoves.amount })
      .from(senetCashMoves)
      .where(and(eq(senetCashMoves.shiftId, shift.id), eq(senetCashMoves.missingInSenet, false)));
    const totals = shiftTotals(shift.endBalance, own);
    let revenueTx = shift.revenueTx;
    if (b.transactions && shift.closedAt) {
      const sum = await first(
        tx
          .select({
            v: sql<number>`COALESCE(SUM(CASE WHEN ${senetTransactions.kind} = 'refund' THEN -${senetTransactions.amount} ELSE ${senetTransactions.amount} END), 0)`,
            n: sql<number>`COUNT(*)`,
          })
          .from(senetTransactions)
          .where(and(eq(senetTransactions.officeId, b.officeId), gte(senetTransactions.at, shift.openedAt), sql`${senetTransactions.at} <= ${shift.closedAt}`)),
      );
      // нет ни одной транзакции в окне смены — контроль неизвестен, а не «ноль выручки»
      revenueTx = Number(sum?.n ?? 0) > 0 ? Number(sum!.v) : null;
    }
    await tx
      .update(senetShifts)
      .set({ ...totals, revenueTx, updatedAt: at })
      .where(eq(senetShifts.id, shift.id));
  }
  return { shifts: b.sessions.length, moves };
}
