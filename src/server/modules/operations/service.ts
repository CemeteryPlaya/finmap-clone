import { and, asc, eq, inArray } from 'drizzle-orm';
import { getCurrency } from '../../../shared/currencies';
import { formatDateRu, todayInTimezone } from '../../../shared/dates';
import { convertMinor } from '../../../shared/decimal';
import { allocate } from '../../../shared/money';
import type { Db, Executor } from '../../db/client';
import { accounts, categories, counterparties, operationLines, operations, operationTags, projects, tags } from '../../db/schema';
import { AppError } from '../../errors';
import { changedFields, mutate } from '../audit/mutate';
import type { AuditService } from '../audit/service';
import { requireCompany } from '../companies/guard';
import type { RatesService } from '../rates/service';
import { assertOperationPayments, operationPayments, replaceOperationPayments, type StockPaymentDto, type StockPaymentInput } from '../stock/payments';

export type OperationType = 'income' | 'expense' | 'transfer';

export interface LineInput {
  categoryId: number | null;
  projectId: number | null;
  amount: number;
}

export interface OperationInput {
  type: OperationType;
  /** ISO-момент; сервис нормализует к UTC фиксированной ширины. */
  paidAt: string;
  accrualDate: string | null;
  accountId: number;
  amount: number;
  toAccountId: number | null;
  toAmount: number | null;
  counterpartyId: number | null;
  comment: string | null;
  lines: LineInput[];
  tagIds: number[];
  /** Оплата закупки: какие поступления склада гасит этот расход. Нет поля — оплат нет. */
  stockPayments?: StockPaymentInput[];
}

export interface OperationLineDto extends LineInput {
  id: number;
  position: number;
  baseAmount: number;
}

export type OperationRow = typeof operations.$inferSelect;

export interface OperationDto extends OperationRow {
  lines: OperationLineDto[];
  tagIds: number[];
  /** Оплаты закупок расхода с номерами поступлений; у строк журнала не заполняется. */
  stockPayments?: StockPaymentDto[];
}

export interface OperationPatch extends Partial<Omit<OperationInput, 'type'>> {
  /** Версия, которую видел клиент. */
  version: number;
  /** «Изменить в перевод» (§10.1 этапа 1.5): у дохода и расхода — смена типа; у перевода ничего не меняет. */
  type?: 'transfer';
}

export interface OperationsService {
  get(companyId: number, id: number): OperationDto;
  create(companyId: number, input: OperationInput, userId: number): OperationDto;
  update(companyId: number, id: number, patch: OperationPatch, userId: number): OperationDto;
  /** Мягкое удаление. */
  remove(companyId: number, id: number, userId: number): OperationDto;
  restore(companyId: number, id: number, userId: number): OperationDto;
}

/** Поля, правка которых пересчитывает курс и сумму в базовой валюте (§4.3) и запрещена на архивном счёте (инвариант 7). */
const MONEY_FIELDS = ['paidAt', 'amount', 'accountId', 'toAccountId', 'toAmount'] as const;

type AccountRow = typeof accounts.$inferSelect;

interface Checked {
  draft: OperationInput;
  account: AccountRow;
  toAccount: AccountRow | null;
}

const inv = (n: number, message: string, fields?: Record<string, string>) => new AppError(422, `INVARIANT_${n}`, message, fields);
const invalid = (fields: Record<string, string>) => new AppError(400, 'VALIDATION', 'Проверьте заполнение полей', fields);
const archivedRef = (message: string) => new AppError(422, 'ARCHIVED_REFERENCE', message);
const uniqueIds = (ids: (number | null)[]) => [...new Set(ids.filter((x): x is number => x !== null))];

export function createOperationsService(d: { db: Db; audit: AuditService; rates: RatesService; timezone: string; now?: () => Date }): OperationsService {
  const { db, audit, rates } = d;
  const now = d.now ?? (() => new Date());
  /** Календарная дата момента в APP_TIMEZONE. */
  const dateOf = (iso: string) => todayInTimezone(d.timezone, new Date(iso));

  function load(companyId: number, id: number): OperationDto {
    const row = db.select().from(operations).where(and(eq(operations.id, id), eq(operations.companyId, companyId))).get();
    if (!row) throw new AppError(404, 'NOT_FOUND', 'Операция не найдена');
    const lines = db
      .select()
      .from(operationLines)
      .where(eq(operationLines.operationId, id))
      .orderBy(asc(operationLines.position))
      .all()
      .map((l) => ({ id: l.id, position: l.position, categoryId: l.categoryId, projectId: l.projectId, amount: l.amount, baseAmount: l.baseAmount }));
    const tagIds = db
      .select({ tagId: operationTags.tagId })
      .from(operationTags)
      .where(eq(operationTags.operationId, id))
      .all()
      .map((t) => t.tagId)
      .sort((a, b) => a - b);
    return { ...row, lines, tagIds, stockPayments: operationPayments(db, id) };
  }

  function draftOf(op: OperationDto): OperationInput {
    return {
      type: op.type,
      paidAt: op.paidAt,
      accrualDate: op.accrualDate,
      accountId: op.accountId,
      amount: op.amount,
      toAccountId: op.toAccountId,
      toAmount: op.toAmount,
      counterpartyId: op.counterpartyId,
      comment: op.comment,
      lines: op.lines.map((l) => ({ categoryId: l.categoryId, projectId: l.projectId, amount: l.amount })),
      tagIds: op.tagIds,
      stockPayments: (op.stockPayments ?? []).map((p) => ({ docId: p.docId, amount: p.amount })),
    };
  }

  /** Архивный счёт, который затрагивает операция (инвариант 7); null — таких нет. */
  function archivedAccountOf(op: OperationRow): AccountRow | null {
    const ids = [op.accountId, op.toAccountId].filter((x): x is number => x !== null);
    return db.select().from(accounts).where(inArray(accounts.id, ids)).all().find((a) => a.archivedAt) ?? null;
  }

  function account(companyId: number, id: number, field: string): AccountRow {
    const row = db.select().from(accounts).where(and(eq(accounts.id, id), eq(accounts.companyId, companyId))).get();
    if (!row) throw inv(5, 'Счёт не найден в этой компании', { [field]: 'Счёт не найден в этой компании' });
    return row;
  }

  /**
   * Инварианты 1, 3–7 на черновике (§4.6) и его нормализация. prev — операция до правки или восстановления:
   * ссылки, которые у неё уже были, могут оставаться архивными (архив запрещает только новый выбор, инварианты 7 и 11).
   */
  function check(companyId: number, input: OperationInput, prev: OperationInput | null): Checked {
    const draft: OperationInput = {
      ...input,
      paidAt: new Date(input.paidAt).toISOString(),
      lines: input.lines.map((l) => ({ categoryId: l.categoryId, projectId: l.projectId, amount: l.amount })),
      tagIds: [...new Set(input.tagIds)].sort((a, b) => a - b),
      stockPayments: (input.stockPayments ?? []).map((p) => ({ docId: p.docId, amount: p.amount })).sort((a, b) => a.docId - b.docId),
    };
    const acc = account(companyId, draft.accountId, 'accountId');
    let toAcc: AccountRow | null = null;

    if (draft.type === 'transfer') {
      if (draft.toAccountId === null) throw invalid({ toAccountId: 'Выберите счёт зачисления' });
      if (draft.toAccountId === draft.accountId) throw inv(4, 'Счета списания и зачисления совпадают', { toAccountId: 'Выберите другой счёт' });
      toAcc = account(companyId, draft.toAccountId, 'toAccountId');
      if (toAcc.currency === acc.currency) {
        if (draft.toAmount === null) draft.toAmount = draft.amount;
        else if (draft.toAmount !== draft.amount) {
          throw inv(4, 'При одной валюте сумма зачисления равна сумме списания', { toAmount: 'Должна совпадать с суммой списания' });
        }
      } else if (draft.toAmount === null) throw invalid({ toAmount: 'Укажите сумму зачисления' });
      if (draft.counterpartyId !== null) throw invalid({ counterpartyId: 'У перевода нет контрагента' });
      if (draft.lines.length > 1) throw invalid({ lines: 'У перевода — не больше одной строки, с проектом' });
      const line = draft.lines[0];
      if (line?.categoryId != null) throw inv(3, 'У перевода нет категории', { lines: 'У перевода нет категории' });
      if (line && line.projectId === null) throw invalid({ lines: 'В строке перевода укажите проект' });
    } else {
      if (draft.toAccountId !== null) throw invalid({ toAccountId: 'Счёт зачисления — только у перевода' });
      if (draft.toAmount !== null) throw invalid({ toAmount: 'Сумма зачисления — только у перевода' });
      // у дохода и расхода не меньше одной строки (§4.5): без строк — одна строка на всю сумму
      if (draft.lines.length === 0) draft.lines = [{ categoryId: null, projectId: null, amount: draft.amount }];
    }
    if (draft.lines.length > 0 && draft.lines.reduce((s, l) => s + l.amount, 0) !== draft.amount) {
      throw inv(1, 'Сумма строк не равна сумме операции', { lines: 'Распределите всю сумму операции' });
    }

    // инвариант 6: не в будущем по APP_TIMEZONE и не раньше открытия затронутых счетов
    const date = dateOf(draft.paidAt);
    if (date > todayInTimezone(d.timezone, now())) {
      throw inv(6, 'Дата оплаты в будущем — плановые операции появятся позже', { paidAt: 'Дата оплаты в будущем' });
    }
    for (const a of [acc, toAcc]) {
      if (a && date < a.openedAt) {
        throw inv(6, `Счёт «${a.name}» открыт ${formatDateRu(a.openedAt)} — операция не может быть раньше`, { paidAt: 'Раньше даты открытия счёта' });
      }
    }

    // инвариант 7: новый выбор архивного счёта
    for (const [a, prevId] of [
      [acc, prev?.accountId],
      [toAcc, prev?.toAccountId],
    ] as const) {
      if (a?.archivedAt && a.id !== prevId) throw archivedRef(`Счёт «${a.name}» в архиве — выберите другой`);
    }

    // категории строк: та же компания (5), вид по типу операции (3), архив — только уже выбранные (7)
    const catIds = uniqueIds(draft.lines.map((l) => l.categoryId));
    const cats = catIds.length ? db.select().from(categories).where(and(eq(categories.companyId, companyId), inArray(categories.id, catIds))).all() : [];
    if (cats.length !== catIds.length) throw inv(5, 'Категория не найдена в этой компании', { lines: 'Категория не найдена в этой компании' });
    const kind = draft.type === 'income' ? 'income' : 'expense';
    if (cats.some((c) => c.kind !== kind)) {
      throw inv(3, draft.type === 'income' ? 'У дохода — только категории доходов' : 'У расхода — только категории расходов', { lines: 'Категория другого вида' });
    }
    const prevCats = new Set(prev?.lines.map((l) => l.categoryId) ?? []);
    const archivedCat = cats.find((c) => c.archivedAt && !prevCats.has(c.id));
    if (archivedCat) throw archivedRef(`Категория «${archivedCat.name}» в архиве — выберите другую`);

    // проекты строк
    const projIds = uniqueIds(draft.lines.map((l) => l.projectId));
    const projs = projIds.length ? db.select().from(projects).where(and(eq(projects.companyId, companyId), inArray(projects.id, projIds))).all() : [];
    if (projs.length !== projIds.length) throw inv(5, 'Проект не найден в этой компании', { lines: 'Проект не найден в этой компании' });
    const prevProjs = new Set(prev?.lines.map((l) => l.projectId) ?? []);
    const archivedProj = projs.find((p) => p.archivedAt && !prevProjs.has(p.id));
    if (archivedProj) throw archivedRef(`Проект «${archivedProj.name}» в архиве — выберите другой`);

    // контрагент
    if (draft.counterpartyId !== null) {
      const cp = db
        .select()
        .from(counterparties)
        .where(and(eq(counterparties.id, draft.counterpartyId), eq(counterparties.companyId, companyId)))
        .get();
      if (!cp) throw inv(5, 'Контрагент не найден в этой компании', { counterpartyId: 'Контрагент не найден в этой компании' });
      if (cp.archivedAt && cp.id !== prev?.counterpartyId) throw archivedRef(`Контрагент «${cp.name}» в архиве — выберите другого`);
    }

    // теги
    if (draft.tagIds.length) {
      const rows = db.select().from(tags).where(and(eq(tags.companyId, companyId), inArray(tags.id, draft.tagIds))).all();
      if (rows.length !== draft.tagIds.length) throw inv(5, 'Тег не найден в этой компании', { tagIds: 'Тег не найден в этой компании' });
      const prevTags = new Set(prev?.tagIds ?? []);
      const archivedTag = rows.find((t) => t.archivedAt && !prevTags.has(t.id));
      if (archivedTag) throw archivedRef(`Тег «${archivedTag.name}» в архиве — выберите другой`);
    }

    // оплаты закупок: расход со счёта в валюте компании, поставщик и поступления из этой компании (§6.1)
    assertOperationPayments(
      db,
      companyId,
      { type: draft.type, amount: draft.amount, counterpartyId: draft.counterpartyId, accountCurrency: acc.currency, baseCurrency: requireCompany(db, companyId).baseCurrency },
      draft.stockPayments ?? [],
    );

    return { draft, account: acc, toAccount: toAcc };
  }

  /** Курс к базовой валюте на дату оплаты и сумма исходной стороны в базовой валюте (§4.3). */
  function baseOf(companyId: number, baseCurrency: string, c: Checked): { rate: string; baseAmount: number } {
    const { rate, display } = rates.resolve(companyId, baseCurrency, c.account.currency, dateOf(c.draft.paidAt));
    const baseAmount = convertMinor(c.draft.amount, rate, getCurrency(c.account.currency).minorUnits, getCurrency(baseCurrency).minorUnits);
    if (!Number.isSafeInteger(baseAmount)) throw invalid({ amount: 'Слишком большая сумма' });
    return { rate: display, baseAmount };
  }

  /** Строки (baseAmount распределяется наибольшим остатком — инвариант 2) и теги операции. */
  function writeLinesAndTags(tx: Executor, operationId: number, draft: OperationInput, baseAmount: number): void {
    tx.delete(operationLines).where(eq(operationLines.operationId, operationId)).run();
    const bases = draft.lines.length ? allocate(baseAmount, draft.lines.map((l) => l.amount)) : [];
    draft.lines.forEach((l, i) => {
      tx.insert(operationLines)
        .values({ operationId, position: i, categoryId: l.categoryId, projectId: l.projectId, amount: l.amount, baseAmount: bases[i]! })
        .run();
    });
    tx.delete(operationTags).where(eq(operationTags.operationId, operationId)).run();
    for (const tagId of draft.tagIds) tx.insert(operationTags).values({ operationId, tagId }).run();
  }

  const svc: OperationsService = {
    get(companyId, id) {
      requireCompany(db, companyId);
      return load(companyId, id);
    },

    create(companyId, input, userId) {
      const company = requireCompany(db, companyId, { writable: true });
      const c = check(companyId, input, null);
      const { rate, baseAmount } = baseOf(companyId, company.baseCurrency, c);
      const { draft } = c;
      const id = mutate(db, audit, (tx, record) => {
        const t = now().toISOString();
        const row = tx
          .insert(operations)
          .values({
            companyId,
            type: draft.type,
            status: 'actual',
            paidAt: draft.paidAt,
            accrualDate: draft.accrualDate,
            accountId: draft.accountId,
            amount: draft.amount,
            toAccountId: draft.toAccountId,
            toAmount: draft.toAmount,
            rate,
            baseAmount,
            counterpartyId: draft.counterpartyId,
            comment: draft.comment,
            createdBy: userId,
            createdAt: t,
            updatedAt: t,
            version: 1,
          })
          .returning({ id: operations.id })
          .get();
        writeLinesAndTags(tx, row.id, draft, baseAmount);
        if (draft.stockPayments?.length) replaceOperationPayments(tx, row.id, draft.stockPayments);
        const { stockPayments, ...rest } = draft;
        const auditDiff = { ...rest, ...(stockPayments?.length ? { stockPayments } : {}), rate, baseAmount };
        record({ companyId, userId, entity: 'operation', entityId: row.id, action: 'create', diff: auditDiff });
        return row.id;
      });
      return load(companyId, id);
    },

    update(companyId, id, patch, userId) {
      const company = requireCompany(db, companyId, { writable: true });
      const current = load(companyId, id);
      if (current.deletedAt) throw new AppError(409, 'VERSION_CONFLICT', 'Операция удалена — обновите страницу');
      if (patch.version !== current.version) throw new AppError(409, 'VERSION_CONFLICT', 'Операция изменена другим пользователем');
      const prev = draftOf(current);
      // «Изменить в перевод» (§10.1 этапа 1.5): схема пропускает только 'transfer', значит исходный тип — доход или расход.
      // Сервер ничего не подставляет сам: счёт зачисления, сброс контрагента, строки и дату сделки клиент присылает явно
      const typeChange = patch.type !== undefined && patch.type !== current.type;
      const next: OperationInput = { ...prev, lines: prev.lines, tagIds: prev.tagIds };
      for (const [key, value] of Object.entries(patch)) {
        if (key !== 'version' && value !== undefined) (next as unknown as Record<string, unknown>)[key] = value;
      }
      if (patch.paidAt !== undefined) next.paidAt = new Date(patch.paidAt).toISOString();
      // новая сумма без новых строк: единственная строка следует за суммой
      if (patch.amount !== undefined && patch.lines === undefined && prev.lines.length === 1) {
        next.lines = [{ ...prev.lines[0]!, amount: next.amount }];
      }
      // перевод: при реальной смене суммы или счетов сумма зачисления при одной валюте пересчитывается в check();
      // те же значения в PATCH (форма шлёт поля целиком) ничего не сбрасывают
      if (
        next.type === 'transfer' &&
        patch.toAmount === undefined &&
        (next.amount !== prev.amount || next.accountId !== prev.accountId || next.toAccountId !== prev.toAccountId)
      ) {
        next.toAmount = null;
      }

      // инвариант 7 — до остальных проверок, чтобы пользователь видел настоящую причину отказа.
      // Сравниваются реальные значения (paidAt уже нормализован, toAmount сброшен только при настоящей смене).
      const locked = archivedAccountOf(current);
      if (locked && typeChange) throw archivedRef(`Операция затрагивает счёт «${locked.name}» в архиве — тип менять нельзя`);
      if (locked && MONEY_FIELDS.some((f) => JSON.stringify(next[f] ?? null) !== JSON.stringify(prev[f] ?? null))) {
        throw archivedRef(`Операция затрагивает счёт «${locked.name}» в архиве — сумму, дату и счета менять нельзя`);
      }
      // у перевода нет даты сделки; только при смене типа — создание и правку прежних переводов правило не трогает
      if (typeChange && next.accrualDate !== null) throw invalid({ accrualDate: 'У перевода нет даты сделки' });

      const c = check(companyId, next, prev);
      const changes = changedFields(prev, c.draft);
      if (!changes) return current;
      // смена типа пересчитывает курс и сумму в базовой валюте всегда — по стороне списания (§10.1 п. 5)
      const recalc = typeChange || MONEY_FIELDS.some((f) => f in changes.after);
      const { rate, baseAmount } = recalc ? baseOf(companyId, company.baseCurrency, c) : { rate: current.rate, baseAmount: current.baseAmount };
      const { draft } = c;
      mutate(db, audit, (tx, record) => {
        const updated = tx
          .update(operations)
          .set({
            type: draft.type,
            paidAt: draft.paidAt,
            accrualDate: draft.accrualDate,
            accountId: draft.accountId,
            amount: draft.amount,
            toAccountId: draft.toAccountId,
            toAmount: draft.toAmount,
            counterpartyId: draft.counterpartyId,
            comment: draft.comment,
            rate,
            baseAmount,
            updatedAt: now().toISOString(),
            version: current.version + 1,
          })
          .where(and(eq(operations.id, id), eq(operations.version, current.version)))
          .returning({ id: operations.id })
          .get();
        if (!updated) throw new AppError(409, 'VERSION_CONFLICT', 'Операция изменена другим пользователем');
        writeLinesAndTags(tx, id, draft, baseAmount);
        if (changes.after.stockPayments !== undefined) replaceOperationPayments(tx, id, draft.stockPayments ?? []);
        record({
          companyId,
          userId,
          entity: 'operation',
          entityId: id,
          action: 'update',
          // тип после правки — для панели «История действий» («Изменён расход», §3.4 этапа 1.5); смена типа
          // (план 1.5-6) видна ещё и в before.type / after.type, как любое изменённое поле
          diff: { type: draft.type, ...changes, ...(recalc ? { recalculated: { rate: [current.rate, rate], baseAmount: [current.baseAmount, baseAmount] } } : {}) },
        });
      });
      return load(companyId, id);
    },

    remove(companyId, id, userId) {
      requireCompany(db, companyId, { writable: true });
      const current = load(companyId, id);
      if (current.deletedAt) return current;
      const locked = archivedAccountOf(current);
      if (locked) throw archivedRef(`Операция затрагивает счёт «${locked.name}» в архиве — удалить её нельзя`);
      mutate(db, audit, (tx, record) => {
        tx.update(operations)
          .set({ deletedAt: now().toISOString(), updatedAt: now().toISOString(), version: current.version + 1 })
          .where(eq(operations.id, id))
          .run();
        record({ companyId, userId, entity: 'operation', entityId: id, action: 'delete', diff: { type: current.type, amount: current.amount, accountId: current.accountId, paidAt: current.paidAt } });
      });
      return load(companyId, id);
    },

    restore(companyId, id, userId) {
      requireCompany(db, companyId, { writable: true });
      const current = load(companyId, id);
      if (!current.deletedAt) return current;
      const locked = archivedAccountOf(current);
      if (locked) throw archivedRef(`Счёт «${locked.name}» в архиве — сначала верните его из архива`);
      // инвариант 11: 3–7 на текущем состоянии справочников; уже выбранные архивные ссылки не мешают
      check(companyId, draftOf(current), draftOf(current));
      mutate(db, audit, (tx, record) => {
        tx.update(operations)
          .set({ deletedAt: null, updatedAt: now().toISOString(), version: current.version + 1 })
          .where(eq(operations.id, id))
          .run();
        record({ companyId, userId, entity: 'operation', entityId: id, action: 'restore', diff: { type: current.type, amount: current.amount, accountId: current.accountId, paidAt: current.paidAt } });
      });
      return load(companyId, id);
    },
  };
  return svc;
}
