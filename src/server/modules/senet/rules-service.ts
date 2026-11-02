import { and, asc, eq, gte, inArray, isNull, lte, max, ne } from 'drizzle-orm';
import type { SenetCheckHistoryInput, SenetHistoryCheck, SenetRuleDto, SenetRuleInput, SenetRuleType } from '../../../shared/schemas/senet';
import type { Db, Executor } from '../../db/client';
import { first } from '../../db/raw';
import { categories, counterparties, operationLines, operations, senetCashMoves, senetConnections, senetOffices, senetRules, senetShifts } from '../../db/schema';
import { AppError } from '../../errors';
import { mutate } from '../audit/mutate';
import type { AuditService } from '../audit/service';
import { requireCompany } from '../companies/guard';
import { normalize } from './posting/normalize';
import { planShift } from './posting/plan';
import { buildRuleSet, type RuleRow, type RuleSet } from './posting/rules';

type Row = typeof senetRules.$inferSelect;
const ENTITY = 'senet_rule';

export const ruleRow = (r: Row): RuleRow => ({
  id: r.id,
  officeId: r.officeId,
  type: r.type,
  pattern: r.pattern,
  match: r.match,
  priority: r.priority,
  categoryId: r.categoryId,
  counterpartyId: r.counterpartyId,
  commentTemplate: r.commentTemplate,
  flags: JSON.parse(r.flags) as RuleRow['flags'],
  archived: r.archivedAt !== null,
});

const dto = (r: Row): SenetRuleDto => ({ ...ruleRow(r), createdFromReview: r.createdFromReview });

/** Правила клуба для разноски: действующие категории и контрагенты компании — для проверки ссылок (rule_broken). */
export async function loadRuleSet(ex: Executor, companyId: number, officeId: number): Promise<RuleSet> {
  const rows = await ex.select().from(senetRules).where(eq(senetRules.companyId, companyId));
  const cats = await ex.select({ id: categories.id }).from(categories).where(and(eq(categories.companyId, companyId), isNull(categories.archivedAt)));
  const cps = await ex.select({ id: counterparties.id }).from(counterparties).where(and(eq(counterparties.companyId, companyId), isNull(counterparties.archivedAt)));
  return buildRuleSet(rows.map(ruleRow), officeId, { categories: new Set(cats.map((c) => c.id)), counterparties: new Set(cps.map((c) => c.id)) });
}

export interface SenetRules {
  list(companyId: number): Promise<SenetRuleDto[]>;
  /** Внутри транзакции вызывающего (ответ очереди с «Запомнить»): без своей истории. */
  createIn(tx: Executor, companyId: number, input: SenetRuleInput & { createdFromReview?: boolean }, userId: number): Promise<Row>;
  create(companyId: number, input: SenetRuleInput, userId: number): Promise<SenetRuleDto>;
  update(companyId: number, id: number, input: SenetRuleInput, userId: number): Promise<SenetRuleDto>;
  archive(companyId: number, id: number, userId: number): Promise<void>;
  reorder(companyId: number, type: SenetRuleType, ids: number[], userId: number): Promise<SenetRuleDto[]>;
  checkHistory(companyId: number, input: SenetCheckHistoryInput): Promise<SenetHistoryCheck>;
}

export function createSenetRules(d: { db: Db; audit: AuditService; now?: () => Date }): SenetRules {
  const { db, audit } = d;
  const now = d.now ?? (() => new Date());

  async function requireRule(ex: Executor, companyId: number, id: number): Promise<Row> {
    const r = await first(ex.select().from(senetRules).where(and(eq(senetRules.id, id), eq(senetRules.companyId, companyId))));
    if (!r) throw new AppError(404, 'NOT_FOUND', 'Правило не найдено');
    return r;
  }

  async function validate(ex: Executor, companyId: number, input: SenetRuleInput, exceptId: number | null): Promise<string> {
    const pattern = normalize(input.pattern);
    const fields: Record<string, string> = {};
    if (input.categoryId !== null) {
      const c = await first(ex.select({ id: categories.id }).from(categories).where(and(eq(categories.id, input.categoryId), eq(categories.companyId, companyId))));
      if (!c) fields.categoryId = 'Категория не найдена';
    }
    if (input.counterpartyId !== null) {
      const c = await first(ex.select({ id: counterparties.id }).from(counterparties).where(and(eq(counterparties.id, input.counterpartyId), eq(counterparties.companyId, companyId))));
      if (!c) fields.counterpartyId = 'Контрагент не найден';
    }
    if (input.officeId !== null) {
      const o = await first(
        ex
          .select({ id: senetOffices.id })
          .from(senetOffices)
          .innerJoin(senetConnections, eq(senetConnections.id, senetOffices.connectionId))
          .where(and(eq(senetOffices.id, input.officeId), eq(senetConnections.companyId, companyId))),
      );
      if (!o) fields.officeId = 'Клуб не найден';
    }
    if (Object.keys(fields).length) throw new AppError(422, 'VALIDATION', 'Проверьте заполнение полей', fields);
    const dup = await first(
      ex
        .select({ id: senetRules.id })
        .from(senetRules)
        .where(
          and(
            eq(senetRules.companyId, companyId),
            eq(senetRules.type, input.type),
            eq(senetRules.pattern, pattern),
            input.officeId === null ? isNull(senetRules.officeId) : eq(senetRules.officeId, input.officeId),
            isNull(senetRules.archivedAt),
            exceptId === null ? undefined : ne(senetRules.id, exceptId),
          ),
        ),
    );
    if (dup) throw new AppError(422, 'SENET_RULE_DUPLICATE', 'Такое правило уже есть');
    return pattern;
  }

  const values = (input: SenetRuleInput, pattern: string) => ({
    officeId: input.officeId,
    type: input.type,
    pattern,
    match: input.match,
    categoryId: input.categoryId,
    counterpartyId: input.counterpartyId,
    commentTemplate: input.commentTemplate || null,
    flags: JSON.stringify(input.flags ?? {}),
  });

  const svc: SenetRules = {
    async list(companyId) {
      await requireCompany(db, companyId);
      const rows = await db.select().from(senetRules).where(eq(senetRules.companyId, companyId)).orderBy(asc(senetRules.type), asc(senetRules.priority), asc(senetRules.id));
      return rows.map(dto);
    },

    async createIn(tx, companyId, input, userId) {
      const pattern = await validate(tx, companyId, input, null);
      const top = await first(tx.select({ v: max(senetRules.priority) }).from(senetRules).where(and(eq(senetRules.companyId, companyId), eq(senetRules.type, input.type))));
      const [row] = await tx
        .insert(senetRules)
        .values({ companyId, ...values(input, pattern), priority: (top?.v ?? -1) + 1, createdFromReview: input.createdFromReview ?? false, createdAt: now().toISOString(), createdBy: userId })
        .returning();
      return row!;
    },

    async create(companyId, input, userId) {
      await requireCompany(db, companyId, { writable: true });
      const row = await mutate(db, audit, async (tx, record) => {
        const created = await svc.createIn(tx, companyId, input, userId);
        await record({ companyId, userId, entity: ENTITY, entityId: created.id, action: 'create', diff: { after: values(input, created.pattern) } });
        return created;
      });
      return dto(row);
    },

    async update(companyId, id, input, userId) {
      await requireCompany(db, companyId, { writable: true });
      const row = await mutate(db, audit, async (tx, record) => {
        const before = await requireRule(tx, companyId, id);
        const pattern = await validate(tx, companyId, input, id);
        const [updated] = await tx.update(senetRules).set(values(input, pattern)).where(eq(senetRules.id, id)).returning();
        await record({ companyId, userId, entity: ENTITY, entityId: id, action: 'update', diff: { before: ruleRow(before), after: values(input, pattern) } });
        return updated!;
      });
      return dto(row);
    },

    async archive(companyId, id, userId) {
      await requireCompany(db, companyId, { writable: true });
      await mutate(db, audit, async (tx, record) => {
        const r = await requireRule(tx, companyId, id);
        if (r.archivedAt) return;
        await tx.update(senetRules).set({ archivedAt: now().toISOString() }).where(eq(senetRules.id, id));
        await record({ companyId, userId, entity: ENTITY, entityId: id, action: 'archive', diff: { before: { type: r.type, pattern: r.pattern } } });
      });
    },

    async reorder(companyId, type, ids, userId) {
      await requireCompany(db, companyId, { writable: true });
      await mutate(db, audit, async (tx, record) => {
        const rows = await tx.select({ id: senetRules.id }).from(senetRules).where(and(eq(senetRules.companyId, companyId), eq(senetRules.type, type), inArray(senetRules.id, ids)));
        if (rows.length !== ids.length) throw new AppError(422, 'VALIDATION', 'Список правил изменился — обновите страницу');
        for (const [i, ruleId] of ids.entries()) await tx.update(senetRules).set({ priority: i }).where(eq(senetRules.id, ruleId));
        await record({ companyId, userId, entity: ENTITY, action: 'reorder', diff: { type, ids } });
      });
      return svc.list(companyId);
    },

    async checkHistory(companyId, input) {
      await requireCompany(db, companyId);
      const rules = await loadRuleSet(db, companyId, input.officeId);
      const shifts = await db
        .select({ shift: senetShifts })
        .from(senetShifts)
        .innerJoin(senetOffices, eq(senetOffices.id, senetShifts.officeId))
        .innerJoin(senetConnections, eq(senetConnections.id, senetOffices.connectionId))
        .where(and(eq(senetShifts.officeId, input.officeId), eq(senetConnections.companyId, companyId), gte(senetShifts.closedAt, input.from), lte(senetShifts.closedAt, input.to)))
        .orderBy(asc(senetShifts.openedAt));
      const result: SenetHistoryCheck = { total: 0, recognized: 0, unrecognized: [], differs: [] };
      // счета и категория дохода плану не важны: сравниваются только расходы
      const accounts = { cashAccountId: 0, kaspiAccountId: 0, incomeCategoryId: 0 };
      for (const { shift } of shifts) {
        const moves = await db.select().from(senetCashMoves).where(and(eq(senetCashMoves.shiftId, shift.id), eq(senetCashMoves.missingInSenet, false))).orderBy(asc(senetCashMoves.at));
        const plan = planShift({ shift: { openedAt: shift.openedAt, closedAt: shift.closedAt!, endBalance: shift.endBalance }, moves, prevEndBalance: null, revenueTx: null, rules, accounts });
        const outs = moves.filter((m) => m.kind === 'out');
        result.total += outs.length;
        const reviewed = new Set(plan.reviews.filter((r) => r.moveIndex !== null).map((r) => r.moveIndex));
        result.recognized += outs.length - reviewed.size;
        for (const r of plan.reviews) {
          if (r.moveIndex === null) continue;
          const m = moves[r.moveIndex]!;
          result.unrecognized.push({ moveId: m.id, at: m.at, amount: m.amount, comment: m.comment, reason: r.reason });
        }
        for (const op of plan.ops) {
          if (op.ref.kind !== 'move') continue;
          const m = moves[op.ref.moveIndex]!;
          if (m.operationId === null) continue;
          const posted = await first(
            db
              .select({ counterpartyId: operations.counterpartyId, categoryId: operationLines.categoryId, deletedAt: operations.deletedAt })
              .from(operations)
              .leftJoin(operationLines, eq(operationLines.operationId, operations.id))
              .where(eq(operations.id, m.operationId))
              .orderBy(asc(operationLines.position)),
          );
          if (!posted || posted.deletedAt) continue;
          if (posted.categoryId !== op.categoryId || posted.counterpartyId !== op.counterpartyId) {
            result.differs.push({
              moveId: m.id,
              operationId: m.operationId,
              comment: m.comment,
              was: { categoryId: posted.categoryId, counterpartyId: posted.counterpartyId },
              would: { categoryId: op.categoryId, counterpartyId: op.counterpartyId },
            });
          }
        }
      }
      return result;
    },
  };
  return svc;
}
