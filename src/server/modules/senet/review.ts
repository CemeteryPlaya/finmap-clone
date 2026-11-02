import { and, asc, eq, isNull } from 'drizzle-orm';
import { todayInTimezone } from '../../../shared/dates';
import type { SenetReviewAnswer, SenetReviewItemDto } from '../../../shared/schemas/senet';
import type { Db, Executor } from '../../db/client';
import { first } from '../../db/raw';
import { operations, senetCashMoves, senetConnections, senetOffices, senetPostings, senetReviewItems, senetShifts } from '../../db/schema';
import { withTx } from '../../db/tx';
import { AppError } from '../../errors';
import type { AuditService } from '../audit/service';
import { requireCompany } from '../companies/guard';
import type { OperationsService } from '../operations/service';
import { normalize } from './posting/normalize';
import { lateOpTime } from './posting/plan';
import type { SenetRules } from './rules-service';

type Item = typeof senetReviewItems.$inferSelect;
type Shift = typeof senetShifts.$inferSelect;
type Office = typeof senetOffices.$inferSelect;
type Move = typeof senetCashMoves.$inferSelect;
interface By {
  userId: number;
  via: 'web' | 'telegram';
}

export interface SenetReview {
  list(companyId: number, o: { status?: 'open' | 'answered' | 'dismissed'; officeId?: number }): Promise<SenetReviewItemDto[]>;
  answer(companyId: number, id: number, a: SenetReviewAnswer, by: By): Promise<SenetReviewItemDto>;
}

const MINUTE = 60_000;

/**
 * Очередь «Разобрать» (§6): ответ создаёт операцию, по желанию — точное правило, и закрывает пункт. API не зависит от
 * экрана: позже на те же пункты ответит Telegram-бот (via = telegram).
 */
export function createSenetReview(d: { db: Db; operations: OperationsService; rules: SenetRules; audit: AuditService; timezone: string; now?: () => Date }): SenetReview {
  const { db } = d;
  const now = d.now ?? (() => new Date());

  const dto = (i: Item, shift: Shift, move: Move | null): SenetReviewItemDto => ({
    id: i.id,
    shiftId: i.shiftId,
    shiftOpenedAt: shift.openedAt,
    shiftClosedAt: shift.closedAt,
    officeId: shift.officeId,
    cashMoveId: i.cashMoveId,
    amount: move?.amount ?? null,
    comment: move?.comment ?? null,
    reason: i.reason,
    suggestions: JSON.parse(i.suggestions) as SenetReviewItemDto['suggestions'],
    status: i.status,
  });

  async function load(ex: Executor, companyId: number, id: number) {
    const row = await first(
      ex
        .select({ item: senetReviewItems, shift: senetShifts, office: senetOffices })
        .from(senetReviewItems)
        .innerJoin(senetShifts, eq(senetShifts.id, senetReviewItems.shiftId))
        .innerJoin(senetOffices, eq(senetOffices.id, senetShifts.officeId))
        .innerJoin(senetConnections, eq(senetConnections.id, senetOffices.connectionId))
        .where(and(eq(senetReviewItems.id, id), eq(senetConnections.companyId, companyId))),
    );
    if (!row) throw new AppError(404, 'NOT_FOUND', 'Пункт не найден');
    const move = row.item.cashMoveId ? ((await first(ex.select().from(senetCashMoves).where(eq(senetCashMoves.id, row.item.cashMoveId)))) ?? null) : null;
    return { ...row, move };
  }

  /** Проведённые выемки смены: время ответа — после них (§4.4). */
  async function moveTimes(ex: Executor, shiftId: number): Promise<string[]> {
    const rows = await ex
      .select({ paidAt: operations.paidAt })
      .from(senetCashMoves)
      .innerJoin(operations, eq(operations.id, senetCashMoves.operationId))
      .where(and(eq(senetCashMoves.shiftId, shiftId), isNull(operations.deletedAt)));
    return rows.map((r) => r.paidAt);
  }

  function ready(office: Office) {
    if (office.projectId === null || office.cashAccountId === null || office.kaspiAccountId === null || office.incomeCategoryId === null)
      throw new AppError(422, 'SENET_OFFICE_NOT_READY', 'Заполните связи клуба Senet');
    return { projectId: office.projectId, cash: office.cashAccountId, kaspi: office.kaspiAccountId, income: office.incomeCategoryId };
  }

  async function expense(ex: Executor, companyId: number, office: Office, shift: Shift, move: Move, a: { categoryId: number; counterpartyId: number | null; comment: string | null }, userId: number, ruleId: number | null) {
    const links = ready(office);
    const paidAt = lateOpTime(shift.closedAt!, await moveTimes(ex, shift.id));
    const op = await d.operations.create(
      companyId,
      {
        type: 'expense',
        paidAt,
        accrualDate: todayInTimezone(d.timezone, new Date(paidAt)),
        accountId: links.cash,
        amount: move.amount,
        toAccountId: null,
        toAmount: null,
        counterpartyId: a.counterpartyId,
        comment: a.comment,
        lines: [{ categoryId: a.categoryId, projectId: links.projectId, amount: move.amount }],
        tagIds: [],
      },
      userId,
    );
    await ex
      .update(senetCashMoves)
      .set({ operationId: op.id, prevOperationId: move.operationId ?? move.prevOperationId, ruleId })
      .where(eq(senetCashMoves.id, move.id));
    return op.id;
  }

  async function income(ex: Executor, companyId: number, office: Office, shiftId: number, kind: 'kaspi' | 'cash', amount: number, paidAt: string, userId: number) {
    const links = ready(office);
    const op = await d.operations.create(
      companyId,
      {
        type: 'income',
        paidAt,
        accrualDate: todayInTimezone(d.timezone, new Date(paidAt)),
        accountId: kind === 'kaspi' ? links.kaspi : links.cash,
        amount,
        toAccountId: null,
        toAmount: null,
        counterpartyId: null,
        comment: null,
        lines: [{ categoryId: links.income, projectId: links.projectId, amount }],
        tagIds: [],
      },
      userId,
    );
    const posting = await first(ex.select().from(senetPostings).where(and(eq(senetPostings.shiftId, shiftId), eq(senetPostings.kind, kind))));
    if (posting) await ex.update(senetPostings).set({ operationId: op.id, prevOperationId: posting.operationId, amount }).where(eq(senetPostings.id, posting.id));
    else await ex.insert(senetPostings).values({ shiftId, kind, operationId: op.id, amount, createdAt: now().toISOString() });
    return op.id;
  }

  async function close(ex: Executor, id: number, status: 'answered' | 'dismissed', answer: object, by: By, operationId: number | null) {
    await ex
      .update(senetReviewItems)
      .set({ status, openKey: null, answer: JSON.stringify(answer), operationId, answeredBy: by.userId, answeredVia: by.via, answeredAt: now().toISOString() })
      .where(eq(senetReviewItems.id, id));
  }

  const svc: SenetReview = {
    async list(companyId, o) {
      await requireCompany(db, companyId);
      const rows = await db
        .select({ item: senetReviewItems, shift: senetShifts, move: senetCashMoves })
        .from(senetReviewItems)
        .innerJoin(senetShifts, eq(senetShifts.id, senetReviewItems.shiftId))
        .innerJoin(senetOffices, eq(senetOffices.id, senetShifts.officeId))
        .innerJoin(senetConnections, eq(senetConnections.id, senetOffices.connectionId))
        .leftJoin(senetCashMoves, eq(senetCashMoves.id, senetReviewItems.cashMoveId))
        .where(and(eq(senetConnections.companyId, companyId), eq(senetReviewItems.status, o.status ?? 'open'), o.officeId ? eq(senetShifts.officeId, o.officeId) : undefined))
        .orderBy(asc(senetShifts.openedAt), asc(senetReviewItems.id));
      return rows.map((r) => dto(r.item, r.shift, r.move));
    },

    async answer(companyId, id, a, by) {
      await requireCompany(db, companyId, { writable: true });
      await withTx(db, async (tx) => {
        const { item, shift, office, move } = await load(tx, companyId, id);
        if (item.status !== 'open') throw new AppError(409, 'SENET_REVIEW_DONE', 'Пункт уже разобран');
        if (a.kind === 'expense') {
          if (!move) throw new AppError(422, 'VALIDATION', 'У пункта нет выемки — ответьте суммами доходов');
          const n = normalize(move.comment);
          if (a.remember && !n) throw new AppError(422, 'SENET_EMPTY_COMMENT', 'Нельзя запомнить пустой комментарий');
          let ruleId: number | null = null;
          if (a.remember) {
            const rule = await d.rules
              .createIn(tx, companyId, { type: 'exact', pattern: move.comment, match: 'phrase', officeId: null, categoryId: a.categoryId, counterpartyId: a.counterpartyId, commentTemplate: a.comment, flags: {}, createdFromReview: true }, by.userId)
              .catch((e: unknown) => {
                // такое правило уже есть — ответ всё равно принимается
                if (e instanceof AppError && e.code === 'SENET_RULE_DUPLICATE') return null;
                throw e;
              });
            ruleId = rule?.id ?? null;
          }
          const opId = await expense(tx, companyId, office, shift, move, a, by.userId, ruleId);
          await close(tx, item.id, 'answered', a, by, opId);
          if (a.remember) {
            // открытые пункты компании с тем же комментарием — тем же ответом
            const others = await tx
              .select({ item: senetReviewItems, shift: senetShifts, office: senetOffices, move: senetCashMoves })
              .from(senetReviewItems)
              .innerJoin(senetCashMoves, eq(senetCashMoves.id, senetReviewItems.cashMoveId))
              .innerJoin(senetShifts, eq(senetShifts.id, senetReviewItems.shiftId))
              .innerJoin(senetOffices, eq(senetOffices.id, senetShifts.officeId))
              .innerJoin(senetConnections, eq(senetConnections.id, senetOffices.connectionId))
              .where(and(eq(senetConnections.companyId, companyId), eq(senetReviewItems.status, 'open')));
            for (const o of others.filter((x) => normalize(x.move.comment) === n)) {
              const otherOp = await expense(tx, companyId, o.office, o.shift, o.move, a, by.userId, ruleId);
              await close(tx, o.item.id, 'answered', { ...a, fromItem: item.id }, by, otherOp);
            }
          }
        } else if (a.kind === 'kaspi') {
          if (item.reason !== 'no_kaspi') throw new AppError(422, 'VALIDATION', 'Этот ответ — только для «нет выноса kaspi»');
          let opId: number | null = null;
          if (a.amount > 0) {
            const cash = await first(tx.select().from(senetPostings).where(and(eq(senetPostings.shiftId, shift.id), eq(senetPostings.kind, 'cash'))));
            const cashOp = cash?.operationId ? await first(tx.select().from(operations).where(and(eq(operations.id, cash.operationId), isNull(operations.deletedAt)))) : undefined;
            if (!cash || !cashOp) throw new AppError(422, 'VALIDATION', 'Доход «Касса» смены не найден в журнале');
            if (a.amount > cashOp.amount) throw new AppError(422, 'VALIDATION', 'Каспи больше дохода «Касса» смены');
            const current = await d.operations.get(companyId, cashOp.id);
            const rest = cashOp.amount - a.amount;
            await d.operations.update(companyId, cashOp.id, { amount: rest, lines: current.lines.map((l) => ({ categoryId: l.categoryId, projectId: l.projectId, amount: rest })), version: current.version }, by.userId);
            await tx.update(senetPostings).set({ amount: rest }).where(eq(senetPostings.id, cash.id));
            opId = await income(tx, companyId, office, shift.id, 'kaspi', a.amount, cashOp.paidAt, by.userId);
          }
          await close(tx, item.id, 'answered', a, by, opId);
        } else if (a.kind === 'incomes') {
          if (item.reason !== 'negative_cash') throw new AppError(422, 'VALIDATION', 'Этот ответ — только для «касса меньше нуля»');
          const paidAt = new Date(Date.parse(lateOpTime(shift.closedAt!, await moveTimes(tx, shift.id))) + MINUTE).toISOString();
          let opId: number | null = null;
          if (a.kaspi > 0) opId = await income(tx, companyId, office, shift.id, 'kaspi', a.kaspi, paidAt, by.userId);
          if (a.cash > 0) opId = await income(tx, companyId, office, shift.id, 'cash', a.cash, paidAt, by.userId);
          await close(tx, item.id, 'answered', a, by, opId);
        } else {
          if (move) await tx.update(senetCashMoves).set({ noRepost: true }).where(eq(senetCashMoves.id, move.id));
          await close(tx, item.id, 'dismissed', a, by, null);
        }
        await d.audit.record({ companyId, userId: by.userId, entity: 'senet_review', entityId: item.id, action: 'update', diff: { reason: item.reason, answer: a, via: by.via } }, tx);
      });
      const fresh = await load(db, companyId, id);
      return dto(fresh.item, fresh.shift, fresh.move);
    },
  };
  return svc;
}

