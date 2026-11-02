import { and, asc, desc, eq, gte, inArray, isNotNull, isNull, lt, or } from 'drizzle-orm';
import { todayInTimezone } from '../../../shared/dates';
import type { Db, Executor } from '../../db/client';
import { first } from '../../db/raw';
import { operations, senetBarPurchases, senetCashMoves, senetConnections, senetOffices, senetPostings, senetShifts } from '../../db/schema';
import { withTx } from '../../db/tx';
import { AppError } from '../../errors';
import type { AuditService } from '../audit/service';
import { requireCompany } from '../companies/guard';
import type { OperationInput, OperationsService } from '../operations/service';
import { senetLinkOf, type SenetLink } from './links';
import { lateOpTime, planShift, type PlannedOp, type ShiftPlan } from './posting/plan';
import { loadRuleSet } from './rules-service';

type Office = typeof senetOffices.$inferSelect;
type Shift = typeof senetShifts.$inferSelect;
type Move = typeof senetCashMoves.$inferSelect;
type Ready = Office & { projectId: number; cashAccountId: number; kaspiAccountId: number; incomeCategoryId: number; historyFrom: string };

const DAY = 86_400_000;
/** Окно пересмотра проведённых смен: поздние выемки, удалённые операции, изменения Senet (С15§5.2 — 26 ч, с запасом). */
const RECHECK_MS = 45 * DAY;

export interface SenetPosting {
  /** Хук забора (AfterOfficeSync): проводка закрытых смен клуба внутри транзакции забора, по точке сохранения на смену. */
  postOffice(tx: Executor, officeId: number): Promise<{ posted: number; errors: number }>;
  /** «Перепровести доходы смены» (§5.4): суммы Каспи и Касса — по текущей выручке Senet, отметка снимается. */
  repostIncomes(companyId: number, shiftId: number, userId: number): Promise<void>;
  /** «Не проводить повторно» у выемки или дохода (§5.3). */
  setNoRepost(companyId: number, operationId: number, value: boolean): Promise<SenetLink>;
  linkOf(companyId: number, operationId: number): Promise<SenetLink | null>;
  /** Связка проведённого с компанией: выемка или доход её смены. */
  plan(ex: Executor, office: Ready, shift: Shift): Promise<{ plan: ShiftPlan; moves: Move[] }>;
}

/** Текст ошибки для «Сверки»: причина без SQL-обёртки драйвера (в ней запрос и суммы). */
export function errorText(e: unknown): string {
  let cur: unknown = e;
  while (cur instanceof Error && !(cur instanceof AppError) && cur.cause instanceof Error) cur = cur.cause;
  const text = cur instanceof Error ? cur.message : String(cur);
  return `Смена не проведена: ${text.startsWith('Failed query') ? 'ошибка записи в базу' : text}`;
}

const ready = (o: Office): o is Ready =>
  o.enabled && o.projectId !== null && o.cashAccountId !== null && o.kaspiAccountId !== null && o.incomeCategoryId !== null && o.historyFrom !== null;

export function createSenetPosting(d: { db: Db; operations: OperationsService; audit: AuditService; timezone: string; now?: () => Date }): SenetPosting {
  const { db, timezone } = d;
  const now = d.now ?? (() => new Date());

  const input = (p: PlannedOp, office: Ready, paidAt = p.paidAt): OperationInput => ({
    type: p.ref.kind === 'income' ? 'income' : 'expense',
    paidAt,
    accrualDate: todayInTimezone(timezone, new Date(paidAt)),
    accountId: p.accountId,
    amount: p.amount,
    toAccountId: null,
    toAmount: null,
    counterpartyId: p.counterpartyId,
    comment: p.comment,
    lines: [{ categoryId: p.categoryId, projectId: office.projectId, amount: p.amount }],
    tagIds: [],
  });

  async function companyOf(ex: Executor, officeId: number) {
    const row = await first(
      ex
        .select({ office: senetOffices, companyId: senetConnections.companyId, userId: senetConnections.createdBy })
        .from(senetOffices)
        .innerJoin(senetConnections, eq(senetConnections.id, senetOffices.connectionId))
        .where(eq(senetOffices.id, officeId)),
    );
    if (!row) throw new AppError(404, 'NOT_FOUND', 'Клуб Senet не найден');
    return row;
  }

  async function liveSet(ex: Executor, ids: (number | null)[]): Promise<Set<number>> {
    const want = ids.filter((x): x is number => x !== null);
    if (!want.length) return new Set();
    const rows = await ex.select({ id: operations.id }).from(operations).where(and(inArray(operations.id, want), isNull(operations.deletedAt)));
    return new Set(rows.map((r) => r.id));
  }

  const svc: SenetPosting = {
    async plan(ex, office, shift) {
      const { companyId } = await companyOf(ex, office.id);
      const rules = await loadRuleSet(ex, companyId, office.id);
      const moves = await ex
        .select()
        .from(senetCashMoves)
        .where(and(eq(senetCashMoves.shiftId, shift.id), eq(senetCashMoves.missingInSenet, false)))
        .orderBy(asc(senetCashMoves.at), asc(senetCashMoves.id));
      const prev = await first(
        ex
          .select({ endBalance: senetShifts.endBalance })
          .from(senetShifts)
          .where(and(eq(senetShifts.officeId, office.id), lt(senetShifts.openedAt, shift.openedAt), isNotNull(senetShifts.closedAt)))
          .orderBy(desc(senetShifts.openedAt))
          .limit(1),
      );
      const plan = planShift({
        shift: { openedAt: shift.openedAt, closedAt: shift.closedAt!, endBalance: shift.endBalance },
        moves,
        prevEndBalance: prev?.endBalance ?? null,
        revenueTx: shift.revenueTx,
        rules,
        accounts: { cashAccountId: office.cashAccountId, kaspiAccountId: office.kaspiAccountId, incomeCategoryId: office.incomeCategoryId },
      });
      return { plan, moves };
    },

    async postOffice(tx, officeId) {
      const { office, companyId, userId } = await companyOf(tx, officeId);
      if (!ready(office)) return { posted: 0, errors: 0 };
      const t = now();
      const shifts = await tx
        .select()
        .from(senetShifts)
        .where(
          and(
            eq(senetShifts.officeId, officeId),
            isNotNull(senetShifts.closedAt),
            gte(senetShifts.openedAt, office.historyFrom),
            or(isNull(senetShifts.postedRevenue), gte(senetShifts.closedAt, new Date(t.getTime() - RECHECK_MS).toISOString())),
          ),
        )
        .orderBy(asc(senetShifts.openedAt));
      let posted = 0;
      let errors = 0;
      for (const shift of shifts) {
        try {
          posted += await withTx(tx, (sp) => postShift(sp, office, shift, companyId, userId));
          if (shift.postError) await tx.update(senetShifts).set({ postError: null }).where(eq(senetShifts.id, shift.id));
        } catch (e) {
          errors++;
          await tx
            .update(senetShifts)
            .set({ postError: errorText(e) })
            .where(eq(senetShifts.id, shift.id));
        }
      }
      return { posted, errors };
    },

    async repostIncomes(companyId, shiftId, userId) {
      await requireCompany(db, companyId, { writable: true });
      await withTx(db, async (tx) => {
        const shift = await first(tx.select().from(senetShifts).where(eq(senetShifts.id, shiftId)));
        const owner = shift ? await companyOf(tx, shift.officeId) : null;
        if (!shift || !owner || owner.companyId !== companyId || !shift.closedAt) throw new AppError(404, 'NOT_FOUND', 'Смена не найдена');
        if (!ready(owner.office)) throw new AppError(422, 'SENET_OFFICE_NOT_READY', 'Заполните связи клуба Senet');
        const office = owner.office;
        const { plan } = await svc.plan(tx, office, shift);
        const postings = await tx.select().from(senetPostings).where(eq(senetPostings.shiftId, shiftId));
        const live = await liveSet(tx, postings.map((p) => p.operationId));
        for (const kind of ['kaspi', 'cash'] as const) {
          const planned = plan.ops.find((o) => o.ref.kind === 'income' && o.ref.income === kind);
          const posting = postings.find((p) => p.kind === kind);
          const opId = posting?.operationId && live.has(posting.operationId) ? posting.operationId : null;
          if (opId && planned) {
            const current = await d.operations.get(companyId, opId);
            await d.operations.update(companyId, opId, { amount: planned.amount, lines: [{ categoryId: planned.categoryId, projectId: office.projectId, amount: planned.amount }], version: current.version }, userId);
          } else if (opId) await d.operations.remove(companyId, opId, userId);
          else if (planned) {
            const created = await d.operations.create(companyId, input(planned, office), userId);
            if (posting) await tx.update(senetPostings).set({ operationId: created.id, prevOperationId: posting.operationId }).where(eq(senetPostings.id, posting.id));
            else await tx.insert(senetPostings).values({ shiftId, kind, operationId: created.id, amount: planned.amount, createdAt: now().toISOString() });
          }
          if (posting) await tx.update(senetPostings).set({ amount: planned?.amount ?? 0 }).where(eq(senetPostings.id, posting.id));
        }
        await tx.update(senetShifts).set({ postedRevenue: plan.revenue, changedAfterPost: false }).where(eq(senetShifts.id, shiftId));
        await d.audit.record({ companyId, userId, entity: 'senet_shift', entityId: shiftId, action: 'post', diff: { repostIncomes: { kaspi: plan.kaspi, cash: plan.cash } } }, tx);
      });
    },

    async setNoRepost(companyId, operationId, value) {
      const link = await svc.linkOf(companyId, operationId);
      if (!link) throw new AppError(404, 'NOT_FOUND', 'Операция не из Senet');
      await withTx(db, async (tx) => {
        if (link.kind === 'move') await tx.update(senetCashMoves).set({ noRepost: value }).where(eq(senetCashMoves.operationId, operationId));
        else await tx.update(senetPostings).set({ noRepost: value }).where(eq(senetPostings.operationId, operationId));
      });
      return { ...link, noRepost: value };
    },

    async linkOf(companyId, operationId) {
      const op = await first(db.select({ companyId: operations.companyId }).from(operations).where(eq(operations.id, operationId)));
      if (!op || op.companyId !== companyId) return null;
      return senetLinkOf(db, operationId);
    },
  };

  /** Проводка одной смены (§5.2–5.4); бросает — вызывающий откатывает точку сохранения. Возвращает число новых операций. */
  async function postShift(tx: Executor, office: Ready, shift: Shift, companyId: number, userId: number): Promise<number> {
    const { plan, moves } = await svc.plan(tx, office, shift);
    const postings = await tx.select().from(senetPostings).where(eq(senetPostings.shiftId, shift.id));
    const live = await liveSet(tx, [...moves.map((m) => m.operationId), ...postings.map((p) => p.operationId)]);
    const firstPost = shift.postedRevenue === null;
    const created: number[] = [];
    const create = async (p: PlannedOp, paidAt?: string) => {
      const op = await d.operations.create(companyId, input(p, office, paidAt), userId);
      created.push(op.id);
      return op;
    };

    // времена проведённых выемок смены — для поздней выемки (§4.4)
    const liveMoveIds = moves.map((m) => m.operationId).filter((x): x is number => x !== null && live.has(x));
    const moveTimes = liveMoveIds.length
      ? (await tx.select({ paidAt: operations.paidAt }).from(operations).where(inArray(operations.id, liveMoveIds))).map((r) => r.paidAt)
      : [];

    for (const p of plan.ops) {
      if (p.ref.kind !== 'move') continue;
      const moveIndex = p.ref.moveIndex;
      const m = moves[moveIndex]!;
      if (m.noRepost || (m.operationId !== null && live.has(m.operationId))) continue;
      // новая выемка уже проведённой смены — после её выемок; удалённая — на своё место
      const paidAt = !firstPost && m.operationId === null ? lateOpTime(shift.closedAt!, moveTimes) : undefined;
      const op = await create(p, paidAt);
      moveTimes.push(op.paidAt);
      await tx
        .update(senetCashMoves)
        .set({ operationId: op.id, prevOperationId: m.operationId ?? m.prevOperationId, ruleId: p.ruleId })
        .where(eq(senetCashMoves.id, m.id));
      const bar = plan.barPurchases.find((b) => b.moveIndex === moveIndex);
      if (bar) {
        await tx.delete(senetBarPurchases).where(eq(senetBarPurchases.cashMoveId, m.id));
        await tx.insert(senetBarPurchases).values(bar.lines.map((l) => ({ cashMoveId: m.id, ...l, mismatch: bar.mismatch })));
      }
    }

    for (const kind of ['kaspi', 'cash'] as const) {
      const planned = plan.ops.find((o) => o.ref.kind === 'income' && o.ref.income === kind);
      const posting = postings.find((p) => p.kind === kind);
      if (posting) {
        if (posting.noRepost || !planned || (posting.operationId !== null && live.has(posting.operationId))) continue;
        // доход удалён в журнале — проводится заново по текущей выручке
        const op = await create(planned);
        await tx.update(senetPostings).set({ operationId: op.id, prevOperationId: posting.operationId, amount: planned.amount }).where(eq(senetPostings.id, posting.id));
      } else if (firstPost && planned) {
        const op = await create(planned);
        await tx.insert(senetPostings).values({ shiftId: shift.id, kind, operationId: op.id, amount: planned.amount, createdAt: now().toISOString() });
      }
    }

    if (firstPost) await tx.update(senetShifts).set({ postedRevenue: plan.revenue, changedAfterPost: false }).where(eq(senetShifts.id, shift.id));
    else {
      // Senet изменил выручку или распределение после проведения — только отметка, корректировку решает владелец
      const amount = (kind: 'kaspi' | 'cash') => plan.ops.find((o) => o.ref.kind === 'income' && o.ref.income === kind)?.amount ?? 0;
      const postedAmount = (kind: 'kaspi' | 'cash') => postings.find((p) => p.kind === kind)?.amount ?? 0;
      const changed = plan.revenue !== shift.postedRevenue || amount('kaspi') !== postedAmount('kaspi') || amount('cash') !== postedAmount('cash');
      if (changed !== shift.changedAfterPost) await tx.update(senetShifts).set({ changedAfterPost: changed }).where(eq(senetShifts.id, shift.id));
    }
    if (created.length) {
      await d.audit.record({ companyId, userId, entity: 'senet_shift', entityId: shift.id, action: 'post', diff: { openedAt: shift.openedAt, closedAt: shift.closedAt, operations: created } }, tx);
    }
    return created.length;
  }

  return svc;
}
