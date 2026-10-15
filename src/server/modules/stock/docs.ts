import { and, desc, eq, gte, inArray, isNull, lt, sql, type SQL } from 'drizzle-orm';
import { addDays, formatDateRu, startOfDayUtc, todayInTimezone } from '../../../shared/dates';
import {
  STOCK_DOC_PREFIX,
  type StockDocCreate,
  type StockDocList,
  type StockDocType,
  type StockDocUpdate,
  type WriteoffReason,
} from '../../../shared/schemas/stock';
import { formatQty, qtyError, UNIT_LABELS } from '../../../shared/stock-qty';
import type { Db, Executor } from '../../db/client';
import { counterparties, stockDocLines, stockDocPayments, stockDocs, stockItems, stockWarehouses } from '../../db/schema';
import { AppError } from '../../errors';
import { changedFields, mutate } from '../audit/mutate';
import type { AuditEntry, AuditService } from '../audit/service';
import { requireCompany } from '../companies/guard';
import { docPayments, paidByDoc, type DocPayment } from './payments';
import { buildPair, clearPair, storedSigs, uniquePairs, type LineSig, type Pair } from './recalc';

export type StockDocRow = typeof stockDocs.$inferSelect;

export interface StockDocLineDto {
  id: number;
  position: number;
  itemId: number;
  qty: number;
  /** Сумма закупки (поступление) или продажи; у списания — null. */
  amount: number | null;
  /** Себестоимость строки продажи или списания по партиям; у поступления и у строки без партии — null. */
  cost: number | null;
  /** Сколько из строки не нашло партии (§5.3, «Нет партии»). */
  uncovered: number;
}

export interface StockDocDto extends StockDocRow {
  lines: StockDocLineDto[];
  /** Сумма строк (поступление, продажа); у списания 0. */
  total: number;
  /** Оплачено расходами журнала (поступление); у остальных 0. Долг = total \u2212 paid, отрицательный — переплата. */
  paid: number;
  /** Расходы журнала, которые платят по поступлению. */
  payments: DocPayment[];
}

export interface StockDocListItem extends StockDocRow {
  total: number;
  linesCount: number;
  paid: number;
}

/** Чем документ меняет чужие проведённые документы (§5.4): окно сохранения предупреждает «Изменится себестоимость {N} продаж после {даты}». */
export interface DocImpact {
  sales: number;
  writeoffs: number;
  /** Момент правки (ISO): меньшая из старой и новой даты документа; null — чужие документы не затронуты. */
  since: string | null;
}

export interface DocSaveResult {
  /** null — пробный расчёт (`dryRun`): ничего не записано. */
  doc: StockDocDto | null;
  impact: DocImpact;
}

export interface StockDocsService {
  list(companyId: number, q: StockDocList): { docs: StockDocListItem[]; hasMore: boolean };
  get(companyId: number, id: number): StockDocDto;
  create(companyId: number, input: StockDocCreate, userId: number): DocSaveResult;
  update(companyId: number, id: number, patch: StockDocUpdate, userId: number): DocSaveResult;
  /** Мягкое удаление: остатки пересчитываются так, будто документа не было. */
  remove(companyId: number, id: number, userId: number, opts?: { dryRun?: boolean }): DocSaveResult;
}

interface Draft {
  type: StockDocType;
  at: string;
  warehouseId: number;
  counterpartyId: number | null;
  reason: WriteoffReason | null;
  comment: string | null;
  lines: { itemId: number; qty: number; amount: number | null }[];
}

/** Пробный расчёт: исключение откатывает транзакцию и несёт результат. */
class DryRun extends Error {
  constructor(readonly impact: DocImpact) {
    super('dry run');
  }
}

const invalid = (fields: Record<string, string>) => new AppError(400, 'VALIDATION', 'Проверьте заполнение полей', fields);
const NO_IMPACT: DocImpact = { sales: 0, writeoffs: 0, since: null };

export function createStockDocsService(d: { db: Db; audit: AuditService; timezone: string; now?: () => Date }): StockDocsService {
  const { db, audit } = d;
  const now = d.now ?? (() => new Date());
  const dateOf = (iso: string) => todayInTimezone(d.timezone, new Date(iso));

  function requireRow(ex: Executor, companyId: number, id: number): StockDocRow {
    const row = ex.select().from(stockDocs).where(and(eq(stockDocs.id, id), eq(stockDocs.companyId, companyId))).get();
    if (!row) throw new AppError(404, 'NOT_FOUND', 'Документ не найден');
    return row;
  }

  function dtoOf(ex: Executor, row: StockDocRow): StockDocDto {
    const lines = ex.select().from(stockDocLines).where(eq(stockDocLines.docId, row.id)).orderBy(stockDocLines.position).all();
    const sums = new Map<number, { cost: number | null; covered: number }>();
    if (lines.length > 0 && (row.type === 'sale' || row.type === 'writeoff')) {
      const rows = ex.all<{ lineId: number; cost: number | null; covered: number }>(sql`
        SELECT line_id AS lineId, SUM(cost) AS cost, COALESCE(SUM(CASE WHEN batch_id IS NOT NULL THEN qty END), 0) AS covered
          FROM stock_allocations WHERE line_id IN (${sql.join(lines.map((l) => sql`${l.id}`), sql`, `)}) GROUP BY line_id`);
      for (const r of rows) sums.set(r.lineId, { cost: r.cost, covered: r.covered });
    }
    const dtoLines: StockDocLineDto[] = lines.map((l) => {
      const s = sums.get(l.id);
      const out = row.type === 'sale' || row.type === 'writeoff';
      return {
        id: l.id,
        position: l.position,
        itemId: l.itemId,
        qty: l.qty,
        amount: l.amount,
        cost: out && s ? s.cost : null,
        uncovered: out ? l.qty - (s?.covered ?? 0) : 0,
      };
    });
    const payments = row.type === 'receipt' ? docPayments(ex, row.id) : [];
    return { ...row, lines: dtoLines, total: dtoLines.reduce((s, l) => s + (l.amount ?? 0), 0), paid: payments.reduce((s, p) => s + p.amount, 0), payments };
  }

  function draftOf(dto: StockDocDto): Draft {
    return {
      type: dto.type as StockDocType,
      at: dto.at,
      warehouseId: dto.warehouseId,
      counterpartyId: dto.counterpartyId,
      reason: dto.reason,
      comment: dto.comment,
      lines: dto.lines.map((l) => ({ itemId: l.itemId, qty: l.qty, amount: l.amount })),
    };
  }

  /**
   * Правила документа (§10): склад, контрагент и товары — из этой компании; архивные — только уже выбранные в этом документе;
   * количество — по единице товара; суммы — у поступления и продажи, причина — у списания; дата не в будущем.
   */
  function check(ex: Executor, companyId: number, input: Draft, prev: Draft | null): Draft {
    const draft: Draft = { ...input, at: new Date(input.at).toISOString(), lines: input.lines.map((l) => ({ ...l })) };

    const wh = ex.select().from(stockWarehouses).where(and(eq(stockWarehouses.id, draft.warehouseId), eq(stockWarehouses.companyId, companyId))).get();
    if (!wh) throw new AppError(422, 'INVARIANT_5', 'Склад не найден в этой компании', { warehouseId: 'Склад не найден в этой компании' });
    if (wh.archivedAt && wh.id !== prev?.warehouseId) throw new AppError(422, 'ARCHIVED_REFERENCE', `Склад «${wh.name}» в архиве — выберите другой`);

    if (dateOf(draft.at) > todayInTimezone(d.timezone, now())) {
      throw new AppError(422, 'INVARIANT_6', 'Дата документа в будущем', { at: 'Дата документа в будущем' });
    }

    if (draft.type === 'writeoff') {
      if (draft.reason === null) throw invalid({ reason: 'Укажите причину списания' });
      if (draft.counterpartyId !== null) throw invalid({ counterpartyId: 'У списания нет контрагента' });
    } else if (draft.reason !== null) {
      throw invalid({ reason: 'Причина — только у списания' });
    }

    if (draft.counterpartyId !== null) {
      const cp = ex
        .select()
        .from(counterparties)
        .where(and(eq(counterparties.id, draft.counterpartyId), eq(counterparties.companyId, companyId)))
        .get();
      if (!cp) throw new AppError(422, 'INVARIANT_5', 'Контрагент не найден в этой компании', { counterpartyId: 'Контрагент не найден в этой компании' });
      if (cp.archivedAt && cp.id !== prev?.counterpartyId) throw new AppError(422, 'ARCHIVED_REFERENCE', `Контрагент «${cp.name}» в архиве — выберите другого`);
    }

    const ids = [...new Set(draft.lines.map((l) => l.itemId))];
    const items = new Map(
      ex
        .select()
        .from(stockItems)
        .where(and(eq(stockItems.companyId, companyId), inArray(stockItems.id, ids)))
        .all()
        .map((i) => [i.id, i]),
    );
    const prevItems = new Set(prev?.lines.map((l) => l.itemId) ?? []);
    draft.lines.forEach((l, i) => {
      const item = items.get(l.itemId);
      if (!item) throw new AppError(422, 'INVARIANT_5', 'Товар не найден в этой компании', { [`lines.${i}.itemId`]: 'Товар не найден в этой компании' });
      if (item.archivedAt && !prevItems.has(item.id)) throw new AppError(422, 'ARCHIVED_REFERENCE', `Товар «${item.name}» в архиве — выберите другой`);
      const qtyProblem = qtyError(l.qty, item.unit);
      if (qtyProblem) throw invalid({ [`lines.${i}.qty`]: qtyProblem });
      if (draft.type === 'writeoff') {
        if (l.amount !== null) throw invalid({ [`lines.${i}.amount`]: 'У списания нет суммы' });
      } else if (l.amount === null) {
        throw invalid({ [`lines.${i}.amount`]: 'Укажите сумму строки' });
      }
    });
    return draft;
  }

  /** Номер по типу в компании: «П-0001», «Р-0001», «С-0001». Удалённые документы номер не освобождают. */
  function nextNumber(ex: Executor, companyId: number, type: StockDocType): string {
    const row = ex
      .select({ m: sql<number>`coalesce(max(cast(substr(${stockDocs.number}, 3) as integer)), 0)` })
      .from(stockDocs)
      .where(and(eq(stockDocs.companyId, companyId), eq(stockDocs.type, type)))
      .get();
    return `${STOCK_DOC_PREFIX[type]}-${String((row?.m ?? 0) + 1).padStart(4, '0')}`;
  }

  function insertLines(tx: Executor, docId: number, lines: Draft['lines']): void {
    lines.forEach((l, i) => {
      tx.insert(stockDocLines).values({ docId, position: i, itemId: l.itemId, qty: l.qty, amount: l.amount }).run();
    });
  }

  /**
   * Изменение документа с пересчётом (§5.2): до правки убираются партии и списания затронутых пар, затем меняются
   * строки, затем пары строятся заново по всем документам. Ручное списание, которому после правки не хватает остатка,
   * откатывает всю транзакцию ответом 422 (§5.3). Возвращает, у скольких чужих продаж и списаний изменилась себестоимость (§5.4).
   */
  function rebuild(tx: Executor, pairs: Pair[], docId: number, sinceAt: string, change: () => void): DocImpact {
    const touched = uniquePairs(pairs);
    const before = new Map<number, LineSig>();
    for (const p of touched) for (const [k, v] of storedSigs(tx, p)) before.set(k, v);
    for (const p of touched) clearPair(tx, p);
    change();
    const changed = { sale: new Set<number>(), writeoff: new Set<number>() };
    for (const p of touched) {
      const { result, sigs } = buildPair(tx, p);
      for (const s of sigs.values()) {
        if (s.type === 'writeoff' && s.uncovered > 0) {
          const item = tx.select().from(stockItems).where(eq(stockItems.id, p.itemId)).get()!;
          const available = result.outs.get(s.lineId)!.available;
          throw new AppError(
            422,
            'INSUFFICIENT_STOCK',
            `Не хватает «${item.name}»: на складе ${formatQty(available)} ${UNIT_LABELS[item.unit]} на ${formatDateRu(dateOf(s.at))}`,
            undefined,
            { itemId: item.id, available, at: s.at },
          );
        }
        const old = before.get(s.lineId);
        if (s.docId !== docId && old && (old.cost !== s.cost || old.uncovered !== s.uncovered)) changed[s.type].add(s.docId);
      }
    }
    const sales = changed.sale.size;
    const writeoffs = changed.writeoff.size;
    return sales + writeoffs === 0 ? NO_IMPACT : { sales, writeoffs, since: sinceAt };
  }

  /** Транзакция записи; пробный расчёт откатывается исключением DryRun. */
  function run(dryRun: boolean, fn: (tx: Executor, record: (entry: AuditEntry) => void) => DocSaveResult): DocSaveResult {
    try {
      return mutate(
        db,
        audit,
        (tx, record) => {
          const out = fn(tx, record);
          if (dryRun) throw new DryRun(out.impact);
          return out;
        },
        { behavior: 'immediate' },
      );
    } catch (e) {
      if (e instanceof DryRun) return { doc: null, impact: e.impact };
      throw e;
    }
  }

  const pairsOf = (draft: Pick<Draft, 'warehouseId' | 'lines'>): Pair[] => draft.lines.map((l) => ({ warehouseId: draft.warehouseId, itemId: l.itemId }));

  const svc: StockDocsService = {
    list(companyId, q) {
      requireCompany(db, companyId);
      const conds: SQL[] = [eq(stockDocs.companyId, companyId), isNull(stockDocs.deletedAt)];
      if (q.type) conds.push(eq(stockDocs.type, q.type));
      if (q.warehouse) conds.push(eq(stockDocs.warehouseId, q.warehouse));
      if (q.from) conds.push(gte(stockDocs.at, startOfDayUtc(q.from, d.timezone)));
      if (q.to) conds.push(lt(stockDocs.at, startOfDayUtc(addDays(q.to, 1), d.timezone)));
      const rows = db
        .select()
        .from(stockDocs)
        .where(and(...conds))
        .orderBy(desc(stockDocs.at), desc(stockDocs.id))
        .limit(q.limit + 1)
        .offset(q.offset)
        .all();
      const page = rows.slice(0, q.limit);
      const totals = new Map<number, { total: number; n: number }>();
      if (page.length > 0) {
        const agg = db.all<{ docId: number; total: number; n: number }>(sql`
          SELECT doc_id AS docId, COALESCE(SUM(amount), 0) AS total, COUNT(*) AS n
            FROM stock_doc_lines WHERE doc_id IN (${sql.join(page.map((r) => sql`${r.id}`), sql`, `)}) GROUP BY doc_id`);
        for (const a of agg) totals.set(a.docId, { total: a.total, n: a.n });
      }
      const paid = paidByDoc(db, page.filter((r) => r.type === 'receipt').map((r) => r.id));
      return {
        docs: page.map((r) => ({ ...r, total: totals.get(r.id)?.total ?? 0, linesCount: totals.get(r.id)?.n ?? 0, paid: paid.get(r.id) ?? 0 })),
        hasMore: rows.length > q.limit,
      };
    },

    get(companyId, id) {
      requireCompany(db, companyId);
      return dtoOf(db, requireRow(db, companyId, id));
    },

    create(companyId, input, userId) {
      requireCompany(db, companyId, { writable: true });
      return run(input.dryRun, (tx, record) => {
        const draft = check(
          tx,
          companyId,
          {
            type: input.type,
            at: input.at,
            warehouseId: input.warehouseId,
            counterpartyId: input.counterpartyId,
            reason: input.reason,
            comment: input.comment ?? null,
            lines: input.lines,
          },
          null,
        );
        const t = now().toISOString();
        const number = nextNumber(tx, companyId, draft.type);
        const row = tx
          .insert(stockDocs)
          .values({
            companyId,
            type: draft.type,
            number,
            at: draft.at,
            warehouseId: draft.warehouseId,
            counterpartyId: draft.counterpartyId,
            reason: draft.reason,
            status: 'posted',
            source: 'manual',
            comment: draft.comment,
            createdBy: userId,
            createdAt: t,
            updatedAt: t,
            version: 1,
          })
          .returning()
          .get();
        const impact = rebuild(tx, pairsOf(draft), row.id, draft.at, () => insertLines(tx, row.id, draft.lines));
        record({ companyId, userId, entity: 'stock_doc', entityId: row.id, action: 'create', diff: { number, ...draft } });
        return { doc: dtoOf(tx, row), impact };
      });
    },

    update(companyId, id, patch, userId) {
      requireCompany(db, companyId, { writable: true });
      return run(patch.dryRun, (tx, record) => {
        const current = requireRow(tx, companyId, id);
        if (current.deletedAt) throw new AppError(409, 'VERSION_CONFLICT', 'Документ удалён — обновите страницу');
        if (patch.version !== current.version) throw new AppError(409, 'VERSION_CONFLICT', 'Документ изменён другим пользователем');
        if (current.type !== 'receipt' && current.type !== 'sale' && current.type !== 'writeoff') {
          throw new AppError(422, 'VALIDATION', 'Этот документ изменить нельзя');
        }
        const currentDto = dtoOf(tx, current);
        const prev = draftOf(currentDto);
        const next: Draft = {
          ...prev,
          ...(patch.at !== undefined ? { at: patch.at } : {}),
          ...(patch.warehouseId !== undefined ? { warehouseId: patch.warehouseId } : {}),
          ...(patch.counterpartyId !== undefined ? { counterpartyId: patch.counterpartyId } : {}),
          ...(patch.reason !== undefined ? { reason: patch.reason } : {}),
          ...(patch.comment !== undefined ? { comment: patch.comment } : {}),
          ...(patch.lines !== undefined ? { lines: patch.lines } : {}),
        };
        const draft = check(tx, companyId, next, prev);
        // поставщика поступления с оплатами менять нельзя: оплаты проведены расходами на прежнего контрагента
        if (draft.counterpartyId !== prev.counterpartyId && tx.select({ docId: stockDocPayments.docId }).from(stockDocPayments).where(eq(stockDocPayments.docId, id)).limit(1).get()) {
          throw new AppError(422, 'STOCK_DOC_HAS_PAYMENTS', 'У поступления есть оплаты — сначала снимите их в расходах');
        }
        const changes = changedFields(prev, draft);
        if (!changes) return { doc: currentDto, impact: NO_IMPACT };
        const sinceAt = draft.at < prev.at ? draft.at : prev.at;
        const impact = rebuild(tx, [...pairsOf(prev), ...pairsOf(draft)], id, sinceAt, () => {
          const updated = tx
            .update(stockDocs)
            .set({
              at: draft.at,
              warehouseId: draft.warehouseId,
              counterpartyId: draft.counterpartyId,
              reason: draft.reason,
              comment: draft.comment,
              updatedAt: now().toISOString(),
              version: current.version + 1,
            })
            .where(and(eq(stockDocs.id, id), eq(stockDocs.version, current.version)))
            .returning({ id: stockDocs.id })
            .get();
          if (!updated) throw new AppError(409, 'VERSION_CONFLICT', 'Документ изменён другим пользователем');
          tx.delete(stockDocLines).where(eq(stockDocLines.docId, id)).run();
          insertLines(tx, id, draft.lines);
        });
        record({ companyId, userId, entity: 'stock_doc', entityId: id, action: 'update', diff: { number: current.number, type: current.type, ...changes } });
        return { doc: dtoOf(tx, requireRow(tx, companyId, id)), impact };
      });
    },

    remove(companyId, id, userId, opts = {}) {
      requireCompany(db, companyId, { writable: true });
      return run(opts.dryRun === true, (tx, record) => {
        const current = requireRow(tx, companyId, id);
        if (current.deletedAt) return { doc: dtoOf(tx, current), impact: NO_IMPACT };
        const dto = dtoOf(tx, current);
        const impact = rebuild(tx, pairsOf(draftOf(dto)), id, current.at, () => {
          tx.update(stockDocs).set({ deletedAt: now().toISOString(), updatedAt: now().toISOString(), version: current.version + 1 }).where(eq(stockDocs.id, id)).run();
        });
        record({ companyId, userId, entity: 'stock_doc', entityId: id, action: 'delete', diff: { number: current.number, type: current.type, at: current.at, total: dto.total } });
        return { doc: dtoOf(tx, requireRow(tx, companyId, id)), impact };
      });
    },
  };
  return svc;
}
