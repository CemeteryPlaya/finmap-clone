import { and, desc, eq, gte, inArray, isNull, lt, or, sql, type SQL } from 'drizzle-orm';
import { addDays, formatDateRu, startOfDayUtc, todayInTimezone } from '../../../shared/dates';
import {
  STOCK_COUNT_LINES_MAX,
  STOCK_DOC_PREFIX,
  type StockCountCreate,
  type StockCountUpdate,
  type StockDocCreate,
  type StockDocList,
  type StockDocType,
  type StockDocUpdate,
  type WriteoffReason,
} from '../../../shared/schemas/stock';
import { formatQty, isWholeUnit, qtyError, QTY_SCALE, UNIT_LABELS, WHOLE_UNIT_ERROR } from '../../../shared/stock-qty';
import type { Db, Executor } from '../../db/client';
import { counterparties, stockComboParts, stockDocLines, stockDocs, stockItems, stockWarehouses } from '../../db/schema';
import { AppError } from '../../errors';
import { changedFields, mutate } from '../audit/mutate';
import type { AuditEntry, AuditService } from '../audit/service';
import { requireCompany } from '../companies/guard';
import { docPayments, paidByDoc, type DocPayment } from './payments';
import { lastPostOf, postedDocs, postingOf, type DocPosting, type LastPost } from './postings';
import { countSummary, expectedQtys, type CountSummary } from './count';
import { buildGroup, clearGroup, groupsOf, storedSigs, type LineSig, type Pair } from './recalc';

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
  /** Только у инвентаризации: факт (null — не посчитан). */
  countedQty?: number | null;
  /** Только у инвентаризации: учёт — у черновика остаток на момент документа сейчас, у проведённой — зафиксированный. */
  expected?: number | null;
}

export interface StockDocDto extends StockDocRow {
  lines: StockDocLineDto[];
  /** Сумма строк (поступление, продажа); у списания 0. */
  total: number;
  /** Оплачено расходами журнала (поступление); у остальных 0. Долг = total \u2212 paid, отрицательный — переплата. */
  paid: number;
  /** Расходы журнала, которые платят по поступлению. */
  payments: DocPayment[];
  /** Продажа, проведённая в журнал; null — не проведена или операция удалена. */
  posting: DocPosting | null;
  /** У продажи: счёт и категория прошлого проведения этого склада — подсказка для окна «Провести в журнал». */
  lastPost: LastPost | null;
  /** Только у инвентаризации: итог проведения («Недостача на X, излишек на Y»); у черновика — null. */
  countSummary?: CountSummary | null;
}

export interface StockDocListItem extends StockDocRow {
  total: number;
  linesCount: number;
  paid: number;
  /** Продажа проведена в журнал. */
  posted: boolean;
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
  /** Тип документа — маршрут правки выбирает по нему схему тела (R15). */
  typeOf(companyId: number, id: number): StockDocType;
  /** Новая инвентаризация — черновик (§7, решение 6). */
  createCount(companyId: number, input: StockCountCreate, userId: number): StockDocDto;
  /** Правка черновика инвентаризации. */
  updateCount(companyId: number, id: number, patch: StockCountUpdate, userId: number): StockDocDto;
  /** «Провести» инвентаризацию: учёт фиксируется, разница — недостача или излишек. */
  post(companyId: number, id: number, version: number, userId: number): StockDocDto;
}

/** Строка черновика инвентаризации. */
interface CountLine {
  itemId: number;
  countedQty: number | null;
}

interface Draft {
  type: StockDocType;
  at: string;
  warehouseId: number;
  /** Склад-получатель перемещения; у других типов — null. */
  toWarehouseId: number | null;
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
    const out = row.type === 'sale' || row.type === 'writeoff' || row.type === 'transfer' || row.type === 'count';
    const isCount = row.type === 'count';
    const draftExpected =
      isCount && row.status === 'draft' && lines.length > 0
        ? expectedQtys(
            ex,
            row.companyId,
            row.warehouseId,
            { at: row.at, docId: row.id, position: -1 },
            lines.map((l) => l.itemId),
          )
        : null;
    // непокрытое — списания строки без партии (R2): у строки комплекта — в единицах составляющих
    const sums = new Map<number, { cost: number | null; uncovered: number }>();
    if (lines.length > 0 && out) {
      const rows = ex.all<{ lineId: number; cost: number | null; uncovered: number }>(sql`
        SELECT line_id AS lineId, SUM(cost) AS cost, COALESCE(SUM(CASE WHEN batch_id IS NULL THEN qty END), 0) AS uncovered
          FROM stock_allocations WHERE line_id IN (${sql.join(lines.map((l) => sql`${l.id}`), sql`, `)}) GROUP BY line_id`);
      for (const r of rows) sums.set(r.lineId, { cost: r.cost, uncovered: r.uncovered });
    }
    const dtoLines: StockDocLineDto[] = lines.map((l) => {
      const s = sums.get(l.id);
      return {
        id: l.id,
        position: l.position,
        itemId: l.itemId,
        qty: l.qty,
        amount: l.amount,
        cost: out && s ? s.cost : null,
        uncovered: out ? (s ? s.uncovered : isCount ? 0 : l.qty) : 0,
        ...(isCount ? { countedQty: l.countedQty, expected: draftExpected ? (draftExpected.get(l.itemId) ?? 0) : l.expectedQty } : {}),
      };
    });
    const payments = row.type === 'receipt' ? docPayments(ex, row.id) : [];
    return { ...row, lines: dtoLines, total: dtoLines.reduce((s, l) => s + (l.amount ?? 0), 0), paid: payments.reduce((s, p) => s + p.amount, 0),
      payments,
      posting: row.type === 'sale' ? postingOf(ex, row.id) : null,
      lastPost: row.type === 'sale' ? lastPostOf(ex, row.warehouseId) : null,
      ...(isCount ? { countSummary: row.status === 'posted' ? countSummary(ex, row.companyId, row.warehouseId, lines) : null } : {}),
    };
  }

  /** Склад инвентаризации: из этой компании, архивный — только уже выбранный. */
  function checkCountWarehouse(ex: Executor, companyId: number, warehouseId: number, prev: number | null): void {
    const wh = ex.select().from(stockWarehouses).where(and(eq(stockWarehouses.id, warehouseId), eq(stockWarehouses.companyId, companyId))).get();
    if (!wh) throw new AppError(422, 'INVARIANT_5', 'Склад не найден в этой компании', { warehouseId: 'Склад не найден в этой компании' });
    if (wh.archivedAt && wh.id !== prev) throw new AppError(422, 'ARCHIVED_REFERENCE', `Склад «${wh.name}» в архиве — выберите другой`);
  }

  function checkNotFuture(at: string): string {
    const iso = new Date(at).toISOString();
    if (dateOf(iso) > todayInTimezone(d.timezone, now())) throw new AppError(422, 'INVARIANT_6', 'Дата документа в будущем', { at: 'Дата документа в будущем' });
    return iso;
  }

  /**
   * Строки инвентаризации (решение 6): товары этой компании без повторов, не комплекты, архивные — только уже бывшие
   * в документе; факт — по единице товара (ноль допустим, у «шт» и «уп» — целое).
   */
  function checkCountLines(ex: Executor, companyId: number, lines: readonly CountLine[], prevItems: ReadonlySet<number>): void {
    const ids = [...new Set(lines.map((l) => l.itemId))];
    const items = new Map(
      ids.length === 0
        ? []
        : ex
            .select()
            .from(stockItems)
            .where(and(eq(stockItems.companyId, companyId), inArray(stockItems.id, ids)))
            .all()
            .map((i) => [i.id, i]),
    );
    const seen = new Set<number>();
    lines.forEach((l, i) => {
      const item = items.get(l.itemId);
      const field = `lines.${i}.itemId`;
      if (!item) throw new AppError(422, 'INVARIANT_5', 'Товар не найден в этой компании', { [field]: 'Товар не найден в этой компании' });
      if (item.isCombo) {
        const message = 'Комплект — только в продаже: используйте его составляющие';
        throw new AppError(422, 'VALIDATION', message, { [field]: message });
      }
      if (seen.has(item.id)) throw invalid({ [field]: 'Товар уже есть в инвентаризации' });
      seen.add(item.id);
      if (item.archivedAt && !prevItems.has(item.id)) throw new AppError(422, 'ARCHIVED_REFERENCE', `Товар «${item.name}» в архиве — выберите другой`);
      if (l.countedQty !== null && isWholeUnit(item.unit) && l.countedQty % QTY_SCALE !== 0) throw invalid({ [`lines.${i}.countedQty`]: WHOLE_UNIT_ERROR });
    });
  }

  function insertCountLines(tx: Executor, docId: number, lines: readonly CountLine[]): void {
    lines.forEach((l, i) => {
      tx.insert(stockDocLines).values({ docId, position: i, itemId: l.itemId, qty: 0, amount: null, countedQty: l.countedQty, expectedQty: null }).run();
    });
  }

  function requireCount(ex: Executor, companyId: number, id: number, version: number): StockDocRow {
    const current = requireRow(ex, companyId, id);
    if (current.type !== 'count') throw new AppError(422, 'VALIDATION', 'Это не инвентаризация');
    if (current.deletedAt) throw new AppError(409, 'VERSION_CONFLICT', 'Документ удалён — обновите страницу');
    if (version !== current.version) throw new AppError(409, 'VERSION_CONFLICT', 'Документ изменён другим пользователем');
    return current;
  }

  function draftOf(dto: StockDocDto): Draft {
    return {
      type: dto.type as StockDocType,
      at: dto.at,
      warehouseId: dto.warehouseId,
      toWarehouseId: dto.toWarehouseId,
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

    if (draft.type === 'count') throw invalid({ type: 'Инвентаризация создаётся отдельно' });

    if (draft.type === 'writeoff') {
      if (draft.reason === null) throw invalid({ reason: 'Укажите причину списания' });
      if (draft.counterpartyId !== null) throw invalid({ counterpartyId: 'У списания нет контрагента' });
    } else if (draft.reason !== null) {
      throw invalid({ reason: 'Причина — только у списания' });
    }

    // перемещение (решение 3 плана Склад-2): получатель — другой склад этой компании, без контрагента и сумм
    if (draft.type === 'transfer') {
      if (draft.toWarehouseId === null) throw invalid({ toWarehouseId: 'Выберите склад-получатель' });
      if (draft.counterpartyId !== null) throw invalid({ counterpartyId: 'У перемещения нет контрагента' });
      if (draft.toWarehouseId === draft.warehouseId) {
        throw new AppError(422, 'VALIDATION', 'Склад-получатель совпадает с отправителем', { toWarehouseId: 'Склад-получатель совпадает с отправителем' });
      }
      const to = ex.select().from(stockWarehouses).where(and(eq(stockWarehouses.id, draft.toWarehouseId), eq(stockWarehouses.companyId, companyId))).get();
      if (!to) throw new AppError(422, 'INVARIANT_5', 'Склад не найден в этой компании', { toWarehouseId: 'Склад не найден в этой компании' });
      if (to.archivedAt && to.id !== prev?.toWarehouseId) throw new AppError(422, 'ARCHIVED_REFERENCE', `Склад «${to.name}» в архиве — выберите другой`);
    } else if (draft.toWarehouseId !== null) {
      throw invalid({ toWarehouseId: 'Склад-получатель — только у перемещения' });
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
      // комплект своего остатка не имеет — только продажа (решение 5)
      if (item.isCombo && draft.type !== 'sale') {
        const message = draft.type === 'receipt' ? 'Комплект нельзя оприходовать — оприходуйте его составляющие' : 'Комплект — только в продаже: используйте его составляющие';
        throw new AppError(422, 'VALIDATION', message, { [`lines.${i}.itemId`]: message });
      }
      const qtyProblem = qtyError(l.qty, item.unit);
      if (qtyProblem) throw invalid({ [`lines.${i}.qty`]: qtyProblem });
      if (draft.type === 'writeoff' || draft.type === 'transfer') {
        if (l.amount !== null) throw invalid({ [`lines.${i}.amount`]: draft.type === 'writeoff' ? 'У списания нет суммы' : 'У перемещения нет суммы' });
      } else if (l.amount === null) {
        throw invalid({ [`lines.${i}.amount`]: 'Укажите сумму строки' });
      }
    });
    return draft;
  }

  /** Номер по типу в компании: «П-0001», «Р-0001», «С-0001», «М-0001», «И-0001». Удалённые документы номер не освобождают. */
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
  function rebuild(tx: Executor, companyId: number, pairs: Pair[], docId: number, sinceAt: string, change: () => void): DocImpact {
    // группы — до изменения строк, по старым и новым парам документа (решение 4 плана Склад-2)
    const groups = groupsOf(tx, companyId, pairs);
    const before = new Map<string, LineSig>();
    for (const g of groups) for (const [k, v] of storedSigs(tx, g)) before.set(k, v);
    for (const g of groups) clearGroup(tx, g);
    change();
    // §5.4: продажи — отдельно, списания и инвентаризации — потери; перемещения в число не входят (R8)
    const changed = { sale: new Set<number>(), loss: new Set<number>() };
    for (const g of groups) {
      const { result, sigs } = buildGroup(tx, companyId, g);
      for (const s of sigs.values()) {
        // ручное списание, перемещение и недостача требуют остатка всегда (§5.3, решения 3 и 6)
        if (s.type !== 'sale' && s.uncovered > 0) {
          const item = tx.select().from(stockItems).where(eq(stockItems.id, g.itemId)).get()!;
          const available = result.outs.get(s.lineId)!.available;
          throw new AppError(
            422,
            'INSUFFICIENT_STOCK',
            `Не хватает «${item.name}»: на складе ${formatQty(available)} ${UNIT_LABELS[item.unit]} на ${formatDateRu(dateOf(s.at))}`,
            undefined,
            { itemId: item.id, available, at: s.at },
          );
        }
        const old = before.get(s.key);
        if (s.type === 'transfer' || s.docId === docId || !old || (old.cost === s.cost && old.uncovered === s.uncovered)) continue;
        (s.type === 'sale' ? changed.sale : changed.loss).add(s.docId);
      }
    }
    const sales = changed.sale.size;
    const writeoffs = changed.loss.size;
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

  /** Пары строк документа: у перемещения — обе стороны, у строки комплекта — пары его составляющих. */
  function pairsOf(ex: Executor, draft: Pick<Draft, 'warehouseId' | 'toWarehouseId' | 'lines'>): Pair[] {
    const ids = [...new Set(draft.lines.map((l) => l.itemId))];
    const parts = new Map<number, number[]>();
    if (ids.length > 0) {
      for (const p of ex.select().from(stockComboParts).where(inArray(stockComboParts.comboId, ids)).all()) {
        const list = parts.get(p.comboId);
        if (list) list.push(p.itemId);
        else parts.set(p.comboId, [p.itemId]);
      }
    }
    const whs = draft.toWarehouseId === null ? [draft.warehouseId] : [draft.warehouseId, draft.toWarehouseId];
    return draft.lines.flatMap((l) => (parts.get(l.itemId) ?? [l.itemId]).flatMap((itemId) => whs.map((warehouseId) => ({ warehouseId, itemId }))));
  }

  const svc: StockDocsService = {
    list(companyId, q) {
      requireCompany(db, companyId);
      const conds: SQL[] = [eq(stockDocs.companyId, companyId), isNull(stockDocs.deletedAt)];
      if (q.type) conds.push(eq(stockDocs.type, q.type));
      // у склада видны и входящие перемещения (R6)
      if (q.warehouse) conds.push(or(eq(stockDocs.warehouseId, q.warehouse), eq(stockDocs.toWarehouseId, q.warehouse))!);
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
      const posted = postedDocs(db, page.filter((r) => r.type === 'sale').map((r) => r.id));
      return {
        docs: page.map((r) => ({ ...r, total: totals.get(r.id)?.total ?? 0, linesCount: totals.get(r.id)?.n ?? 0, paid: paid.get(r.id) ?? 0, posted: posted.has(r.id) })),
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
            toWarehouseId: input.toWarehouseId,
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
            toWarehouseId: draft.toWarehouseId,
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
        const impact = rebuild(tx, companyId, pairsOf(tx, draft), row.id, draft.at, () => insertLines(tx, row.id, draft.lines));
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
        if (current.type === 'count') {
          // у инвентаризации своё тело правки: маршрут вызывает updateCount (R15)
          throw new AppError(422, 'VALIDATION', 'Этот документ изменить нельзя');
        }
        const currentDto = dtoOf(tx, current);
        const prev = draftOf(currentDto);
        const next: Draft = {
          ...prev,
          ...(patch.at !== undefined ? { at: patch.at } : {}),
          ...(patch.warehouseId !== undefined ? { warehouseId: patch.warehouseId } : {}),
          ...(patch.toWarehouseId !== undefined ? { toWarehouseId: patch.toWarehouseId } : {}),
          ...(patch.counterpartyId !== undefined ? { counterpartyId: patch.counterpartyId } : {}),
          ...(patch.reason !== undefined ? { reason: patch.reason } : {}),
          ...(patch.comment !== undefined ? { comment: patch.comment } : {}),
          ...(patch.lines !== undefined ? { lines: patch.lines } : {}),
        };
        const draft = check(tx, companyId, next, prev);
        // поставщика поступления с оплатами менять нельзя: оплаты проведены расходами на прежнего контрагента (удалённые расходы не считаются)
        if (draft.counterpartyId !== prev.counterpartyId && docPayments(tx, id).length > 0) {
          throw new AppError(422, 'STOCK_DOC_HAS_PAYMENTS', 'У поступления есть оплаты — сначала снимите их в расходах');
        }
        const changes = changedFields(prev, draft);
        if (!changes) return { doc: currentDto, impact: NO_IMPACT };
        const sinceAt = draft.at < prev.at ? draft.at : prev.at;
        const impact = rebuild(tx, companyId, [...pairsOf(tx, prev), ...pairsOf(tx, draft)], id, sinceAt, () => {
          const updated = tx
            .update(stockDocs)
            .set({
              at: draft.at,
              warehouseId: draft.warehouseId,
              toWarehouseId: draft.toWarehouseId,
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
        const markDeleted = () => {
          tx.update(stockDocs).set({ deletedAt: now().toISOString(), updatedAt: now().toISOString(), version: current.version + 1 }).where(eq(stockDocs.id, id)).run();
        };
        // черновик инвентаризации в FIFO не участвует — пересчитывать нечего (решение 6)
        let impact = NO_IMPACT;
        if (current.type === 'count' && current.status === 'draft') markDeleted();
        else impact = rebuild(tx, companyId, pairsOf(tx, draftOf(dto)), id, current.at, markDeleted);
        record({ companyId, userId, entity: 'stock_doc', entityId: id, action: 'delete', diff: { number: current.number, type: current.type, at: current.at, total: dto.total } });
        return { doc: dtoOf(tx, requireRow(tx, companyId, id)), impact };
      });
    },

    typeOf(companyId, id) {
      requireCompany(db, companyId);
      return requireRow(db, companyId, id).type as StockDocType;
    },

    createCount(companyId, input, userId) {
      requireCompany(db, companyId, { writable: true });
      return mutate(
        db,
        audit,
        (tx, record) => {
          checkCountWarehouse(tx, companyId, input.warehouseId, null);
          const at = checkNotFuture(input.at);
          checkCountLines(tx, companyId, input.lines, new Set());
          const t = now().toISOString();
          const number = nextNumber(tx, companyId, 'count');
          const row = tx
            .insert(stockDocs)
            .values({
              companyId,
              type: 'count',
              number,
              at,
              warehouseId: input.warehouseId,
              status: 'draft',
              source: 'manual',
              comment: input.comment ?? null,
              createdBy: userId,
              createdAt: t,
              updatedAt: t,
              version: 1,
            })
            .returning()
            .get();
          const lines: CountLine[] = [...input.lines];
          if (input.fill) {
            // все товары склада с ненулевым остатком на момент документа, кроме уже переданных, — по названию
            const given = new Set(lines.map((l) => l.itemId));
            const expected = expectedQtys(tx, companyId, input.warehouseId, { at, docId: row.id, position: -1 });
            const ids = [...expected].filter(([itemId, qty]) => qty !== 0 && !given.has(itemId)).map(([itemId]) => itemId);
            if (ids.length > 0) {
              const ordered = tx
                .select({ id: stockItems.id })
                .from(stockItems)
                .where(and(inArray(stockItems.id, ids), eq(stockItems.isCombo, false)))
                .orderBy(stockItems.nameKey, stockItems.id)
                .all();
              for (const i of ordered) lines.push({ itemId: i.id, countedQty: null });
            }
          }
          if (lines.length > STOCK_COUNT_LINES_MAX) {
            throw new AppError(422, 'VALIDATION', `На складе больше ${STOCK_COUNT_LINES_MAX} товаров с остатком`);
          }
          insertCountLines(tx, row.id, lines);
          record({ companyId, userId, entity: 'stock_doc', entityId: row.id, action: 'create', diff: { number, type: 'count', at, warehouseId: input.warehouseId, lines: lines.length } });
          return dtoOf(tx, row);
        },
        { behavior: 'immediate' },
      );
    },

    updateCount(companyId, id, patch, userId) {
      requireCompany(db, companyId, { writable: true });
      return mutate(
        db,
        audit,
        (tx, record) => {
          const current = requireCount(tx, companyId, id, patch.version);
          if (current.status === 'posted') throw new AppError(422, 'VALIDATION', 'Проведённую инвентаризацию изменить нельзя — удалите её и проведите заново');
          if (patch.warehouseId !== undefined && patch.warehouseId !== current.warehouseId) {
            throw new AppError(422, 'VALIDATION', 'Склад инвентаризации не меняется', { warehouseId: 'Склад инвентаризации не меняется' });
          }
          const prevLines = tx.select().from(stockDocLines).where(eq(stockDocLines.docId, id)).orderBy(stockDocLines.position).all();
          const prev = { at: current.at, comment: current.comment, lines: prevLines.map((l) => ({ itemId: l.itemId, countedQty: l.countedQty })) };
          const next = {
            at: patch.at !== undefined ? checkNotFuture(patch.at) : prev.at,
            comment: patch.comment !== undefined ? patch.comment : prev.comment,
            lines: patch.lines ?? prev.lines,
          };
          if (patch.lines !== undefined) checkCountLines(tx, companyId, patch.lines, new Set(prev.lines.map((l) => l.itemId)));
          const changes = changedFields(prev, next);
          if (!changes) return dtoOf(tx, current);
          tx.update(stockDocs).set({ at: next.at, comment: next.comment, updatedAt: now().toISOString(), version: current.version + 1 }).where(eq(stockDocs.id, id)).run();
          if (patch.lines !== undefined) {
            tx.delete(stockDocLines).where(eq(stockDocLines.docId, id)).run();
            insertCountLines(tx, id, next.lines);
          }
          record({ companyId, userId, entity: 'stock_doc', entityId: id, action: 'update', diff: { number: current.number, type: 'count', ...changes } });
          return dtoOf(tx, requireRow(tx, companyId, id));
        },
        { behavior: 'immediate' },
      );
    },

    post(companyId, id, version, userId) {
      requireCompany(db, companyId, { writable: true });
      const out = run(false, (tx, record) => {
        const current = requireCount(tx, companyId, id, version);
        if (current.status === 'posted') throw new AppError(422, 'VALIDATION', 'Инвентаризация уже проведена');
        const lines = tx.select().from(stockDocLines).where(eq(stockDocLines.docId, id)).orderBy(stockDocLines.position).all();
        if (lines.length === 0) throw new AppError(422, 'VALIDATION', 'Добавьте хотя бы одну строку');
        const blank = lines.findIndex((l) => l.countedQty === null);
        if (blank >= 0) throw new AppError(422, 'VALIDATION', 'Проверьте заполнение полей', { [`lines.${blank}.countedQty`]: 'Внесите факт или удалите строку' });
        // учёт — остаток строго перед документом; после проведения он зафиксирован (§7)
        const expected = expectedQtys(
          tx,
          companyId,
          current.warehouseId,
          { at: current.at, docId: id, position: -1 },
          lines.map((l) => l.itemId),
        );
        const impact = rebuild(
          tx,
          companyId,
          lines.map((l) => ({ warehouseId: current.warehouseId, itemId: l.itemId })),
          id,
          current.at,
          () => {
            for (const l of lines) {
              const e = expected.get(l.itemId) ?? 0;
              tx.update(stockDocLines).set({ expectedQty: e, qty: Math.abs(l.countedQty! - e) }).where(eq(stockDocLines.id, l.id)).run();
            }
            tx.update(stockDocs).set({ status: 'posted', updatedAt: now().toISOString(), version: current.version + 1 }).where(eq(stockDocs.id, id)).run();
          },
        );
        const summary = countSummary(tx, companyId, current.warehouseId, lines);
        record({
          companyId,
          userId,
          entity: 'stock_doc',
          entityId: id,
          action: 'update',
          diff: { number: current.number, type: 'count', before: { status: 'draft' }, after: { status: 'posted' }, shortage: summary.shortage, surplus: summary.surplus },
        });
        return { doc: dtoOf(tx, requireRow(tx, companyId, id)), impact };
      });
      return out.doc!;
    },
  };
  return svc;
}
