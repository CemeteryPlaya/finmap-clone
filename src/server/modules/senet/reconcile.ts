import { and, asc, desc, eq, gte, inArray, isNull, lt, lte, or, sql } from 'drizzle-orm';
import type { Db, Executor } from '../../db/client';
import { first } from '../../db/raw';
import { accounts, operations, senetCashMoves, senetConnections, senetOffices, senetPostings, senetReviewItems, senetShifts } from '../../db/schema';
import { AppError } from '../../errors';
import { requireCompany } from '../companies/guard';
import type { SenetPosting } from './post';

export type ShiftState = 'ok' | 'open' | 'not_posted' | 'off' | 'cash_diff' | 'review' | 'changed' | 'deposit_mismatch';

export interface ShiftRowDto {
  id: number;
  officeId: number;
  openedAt: string;
  closedAt: string | null;
  cashier: string;
  revenue: number;
  revenueTx: number | null;
  kaspi: { posted: number; senet: number };
  cash: { posted: number; senet: number };
  moves: { posted: number; total: number; queued: number };
  cashAfter: { senet: number; journal: number } | null;
  states: ShiftState[];
}

const GRACE_MS = 3 * 3_600_000;
const WARNINGS = { deposit_mismatch: 'Внесение не равно остатку прошлой смены', revenue_tx_mismatch: 'Выручка не сходится с транзакциями Senet' } as const;

/**
 * «Сверка Senet» (§8.3): строки смен с остатком кассы после смены «Senet + разница / журнал». Остаток журнала — остаток
 * счёта кассы на момент последней операции смены (не раньше закрытия) включительно; первая смена с расхождением кассы —
 * главный инструмент контроля разноски.
 */
export function createSenetReconcile(d: { db: Db; posting: SenetPosting }) {
  const { db } = d;

  /** Остаток счёта на момент t включительно: начальный + доходы − расходы ± переводы. */
  async function balanceAt(ex: Executor, accountId: number, t: string): Promise<number> {
    const acc = await first(ex.select({ start: accounts.startingBalance }).from(accounts).where(eq(accounts.id, accountId)));
    const row = await first(
      ex
        .select({
          v: sql<number>`COALESCE(SUM(CASE
            WHEN ${operations.type} = 'income' AND ${operations.accountId} = ${accountId} THEN ${operations.amount}
            WHEN ${operations.type} IN ('expense', 'transfer') AND ${operations.accountId} = ${accountId} THEN -${operations.amount}
            WHEN ${operations.type} = 'transfer' AND ${operations.toAccountId} = ${accountId} THEN ${operations.toAmount}
            ELSE 0 END), 0)`,
        })
        .from(operations)
        .where(and(or(eq(operations.accountId, accountId), eq(operations.toAccountId, accountId)), eq(operations.status, 'actual'), isNull(operations.deletedAt), lte(operations.paidAt, t))),
    );
    return Number(acc?.start ?? 0) + Number(row?.v ?? 0);
  }

  async function officesOf(companyId: number, projectId?: number) {
    return db
      .select({ office: senetOffices })
      .from(senetOffices)
      .innerJoin(senetConnections, eq(senetConnections.id, senetOffices.connectionId))
      .where(and(eq(senetConnections.companyId, companyId), projectId ? eq(senetOffices.projectId, projectId) : undefined));
  }

  async function row(office: typeof senetOffices.$inferSelect, shift: typeof senetShifts.$inferSelect) {
    const states: ShiftState[] = [];
    const base = { id: shift.id, officeId: office.id, openedAt: shift.openedAt, closedAt: shift.closedAt, cashier: shift.closedBy ?? shift.openedBy, revenue: shift.revenue, revenueTx: shift.revenueTx };
    const moves = await db.select().from(senetCashMoves).where(and(eq(senetCashMoves.shiftId, shift.id), eq(senetCashMoves.missingInSenet, false))).orderBy(asc(senetCashMoves.at), asc(senetCashMoves.id));
    const postings = await db.select().from(senetPostings).where(eq(senetPostings.shiftId, shift.id));
    const opIds = [...moves.map((m) => m.operationId), ...postings.map((p) => p.operationId)].filter((x): x is number => x !== null);
    const liveOps = opIds.length ? await db.select({ id: operations.id, paidAt: operations.paidAt, amount: operations.amount }).from(operations).where(and(inArray(operations.id, opIds), isNull(operations.deletedAt))) : [];
    const live = new Map(liveOps.map((o) => [o.id, o]));
    const queued = await db.select({ id: senetReviewItems.id, moveId: senetReviewItems.cashMoveId }).from(senetReviewItems).where(and(eq(senetReviewItems.shiftId, shift.id), eq(senetReviewItems.status, 'open')));
    const outs = moves.filter((m) => m.kind === 'out');
    const movesInfo = { posted: outs.filter((m) => m.operationId !== null && live.has(m.operationId)).length, total: outs.length, queued: queued.filter((q) => q.moveId !== null).length };
    if (!shift.closedAt) return { ...base, kaspi: { posted: 0, senet: 0 }, cash: { posted: 0, senet: 0 }, moves: movesInfo, cashAfter: null, states: ['open'] as ShiftState[], warnings: [] as string[], moveRows: moves, postings, live };

    const ready = office.cashAccountId !== null && office.kaspiAccountId !== null && office.incomeCategoryId !== null && office.projectId !== null;
    const plan = ready ? (await d.posting.plan(db, office as never, shift)).plan : null;
    const posted = (kind: 'kaspi' | 'cash') => {
      const p = postings.find((x) => x.kind === kind);
      return p?.operationId && live.has(p.operationId) ? live.get(p.operationId)!.amount : 0;
    };
    let kaspiPosted = posted('kaspi');
    let cashPosted = posted('cash');
    const beforeHistory = office.historyFrom === null || shift.openedAt < office.historyFrom;
    if (beforeHistory) {
      states.push('not_posted');
      // смены до «Загружать с даты» внесены вручную: доходы — по счёту клуба и времени (С15§6.2)
      const windowEnd = new Date(Date.parse(shift.closedAt) + GRACE_MS).toISOString();
      const sumOn = async (accountId: number | null) =>
        accountId === null
          ? 0
          : Number(
              (
                await first(
                  db
                    .select({ v: sql<number>`COALESCE(SUM(${operations.amount}), 0)` })
                    .from(operations)
                    .where(and(eq(operations.accountId, accountId), eq(operations.type, 'income'), isNull(operations.deletedAt), gte(operations.paidAt, shift.openedAt), lt(operations.paidAt, windowEnd))),
                )
              )?.v ?? 0,
            );
      kaspiPosted = await sumOn(office.kaspiAccountId);
      cashPosted = await sumOn(office.cashAccountId);
    }
    let cashAfter: ShiftRowDto['cashAfter'] = null;
    if (office.cashAccountId !== null) {
      const last = liveOps.reduce((t, o) => (o.paidAt > t ? o.paidAt : t), shift.closedAt);
      cashAfter = { senet: shift.endBalance + office.cashOffset, journal: await balanceAt(db, office.cashAccountId, last) };
    }
    // выключенный клуб не проводится: расхождение кассы — не ошибка разноски, а ожидаемое
    if (!beforeHistory && !office.enabled) states.push('off');
    else if (!beforeHistory) {
      if (cashAfter && cashAfter.senet !== cashAfter.journal) states.push('cash_diff');
      if (queued.length) states.push('review');
      if (shift.changedAfterPost) states.push('changed');
      if (plan?.warnings.includes('deposit_mismatch')) states.push('deposit_mismatch');
      if (states.length === 0) states.push('ok');
    }
    const warnings: string[] = (plan?.warnings ?? []).map((w) => WARNINGS[w]);
    if (shift.postError) warnings.push(shift.postError);
    return {
      ...base,
      kaspi: { posted: kaspiPosted, senet: plan?.kaspi ?? 0 },
      cash: { posted: cashPosted, senet: Math.max(plan?.cash ?? 0, 0) },
      moves: movesInfo,
      cashAfter,
      states,
      warnings,
      moveRows: moves,
      postings,
      live,
    };
  }

  const strip = ({ warnings: _w, moveRows: _m, postings: _p, live: _l, ...r }: Awaited<ReturnType<typeof row>>): ShiftRowDto => r;

  return {
    async list(companyId: number, q: { projectId?: number; from: string; to: string; onlyDiff: boolean }) {
      await requireCompany(db, companyId);
      const rows: ShiftRowDto[] = [];
      for (const { office } of await officesOf(companyId, q.projectId)) {
        const shifts = await db
          .select()
          .from(senetShifts)
          .where(and(eq(senetShifts.officeId, office.id), gte(senetShifts.openedAt, q.from), lt(senetShifts.openedAt, q.to)))
          .orderBy(asc(senetShifts.openedAt));
        for (const s of shifts) rows.push(strip(await row(office, s)));
      }
      rows.sort((a, b) => (a.openedAt < b.openedAt ? -1 : a.openedAt > b.openedAt ? 1 : a.officeId - b.officeId));
      const firstCashDiffId = rows.find((r) => r.states.includes('cash_diff'))?.id ?? null;
      const shown = q.onlyDiff ? rows.filter((r) => !r.states.every((s) => s === 'ok' || s === 'open')) : rows;
      const sum = (f: (r: ShiftRowDto) => number) => shown.reduce((t, r) => t + f(r), 0);
      return {
        rows: shown,
        totals: { revenue: sum((r) => r.revenue), kaspi: { posted: sum((r) => r.kaspi.posted), senet: sum((r) => r.kaspi.senet) }, cash: { posted: sum((r) => r.cash.posted), senet: sum((r) => r.cash.senet) } },
        firstCashDiffId,
      };
    },

    async detail(companyId: number, shiftId: number) {
      await requireCompany(db, companyId);
      const found = await first(
        db
          .select({ shift: senetShifts, office: senetOffices })
          .from(senetShifts)
          .innerJoin(senetOffices, eq(senetOffices.id, senetShifts.officeId))
          .innerJoin(senetConnections, eq(senetConnections.id, senetOffices.connectionId))
          .where(and(eq(senetShifts.id, shiftId), eq(senetConnections.companyId, companyId))),
      );
      if (!found) throw new AppError(404, 'NOT_FOUND', 'Смена не найдена');
      const r = await row(found.office, found.shift);
      const liveId = (id: number | null) => (id !== null && r.live.has(id) ? id : null);
      return {
        ...strip(r),
        moves: r.moveRows.map((m) => ({ id: m.id, at: m.at, kind: m.kind, amount: m.amount, comment: m.comment, ruleId: m.ruleId, operationId: liveId(m.operationId), noRepost: m.noRepost, missingInSenet: m.missingInSenet })),
        movesSummary: strip(r).moves,
        incomes: (['kaspi', 'cash'] as const)
          .map((kind) => r.postings.find((p) => p.kind === kind))
          .filter((p): p is NonNullable<typeof p> => p !== undefined)
          .map((p) => ({ kind: p.kind, amount: p.amount, operationId: liveId(p.operationId), noRepost: p.noRepost })),
        warnings: r.warnings,
      };
    },

    /** «Загружать с даты» — начало первой смены, которой ещё нет в журнале (§5.5): закрытой позже последней операции кассы. */
    async historyFromSuggestion(companyId: number, officeId: number): Promise<{ openedAt: string | null }> {
      const offices = await officesOf(companyId);
      const office = offices.find((o) => o.office.id === officeId)?.office;
      if (!office) throw new AppError(404, 'NOT_FOUND', 'Клуб Senet не найден');
      const last =
        office.cashAccountId === null
          ? null
          : await first(db.select({ paidAt: operations.paidAt }).from(operations).where(and(eq(operations.accountId, office.cashAccountId), isNull(operations.deletedAt))).orderBy(desc(operations.paidAt)).limit(1));
      const shift = await first(
        db
          .select({ openedAt: senetShifts.openedAt })
          .from(senetShifts)
          .where(and(eq(senetShifts.officeId, officeId), last ? or(isNull(senetShifts.closedAt), sql`${senetShifts.closedAt} > ${last.paidAt}`) : undefined))
          .orderBy(asc(senetShifts.openedAt))
          .limit(1),
      );
      return { openedAt: shift?.openedAt ?? null };
    },
  };
}

export type SenetReconcile = ReturnType<typeof createSenetReconcile>;
