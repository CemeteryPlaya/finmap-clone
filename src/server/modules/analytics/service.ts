import { asc, eq, sql, type SQL } from 'drizzle-orm';
import { addDays, startOfDayUtc, todayInTimezone } from '../../../shared/dates';
import type { Dec } from '../../../shared/decimal';
import {
  balanceSeries,
  cashflowRows,
  columnStarts,
  drillRange,
  hidesBalances,
  parseDrillRow,
  reportColumns,
  type AccountLeg,
  type BalanceAccount,
  type DrillSpec,
  type ReportColumn,
  type ReportDicts,
  type ReportFilter,
  type ReportLine,
  type ReportRow,
  type TransferLeg,
} from '../../../shared/report-engine';
import { isFullyPaid, paymentExclusions, pnlExcludedCategories, pnlRows, type PaidOperation, type StockCost, type StockInput } from '../../../shared/report-pnl';
import { reportFilter, type CellQuery, type ReportQuery } from '../../../shared/schemas/analytics';
import type { SystemKey } from '../../../shared/system-categories';
import type { Db } from '../../db/client';
import { accounts, categories, counterparties, projects } from '../../db/schema';
import { AppError } from '../../errors';
import { requireCompany } from '../companies/guard';
import { decodeCursor, encodeCursor, type JournalItem, type JournalService } from '../operations/journal';
import type { RatesService } from '../rates/service';

/** Ответ отчёта (§3.2): колонки шага, дерево строк и сведения о расчёте. */
export interface ReportResponse {
  columns: ReportColumn[];
  rows: ReportRow[];
  meta: {
    from: string;
    to: string;
    step: ReportQuery['step'];
    by: ReportQuery['by'];
    /** Базовая валюта компании: в ней все суммы отчёта. */
    currency: string;
    /** В периоде нет ни одной строки операций (после фильтров). */
    empty: boolean;
    /** Остатки скрыты фильтром не по счетам (§4.1). */
    balancesHidden: boolean;
    /** «Прибыль»: склад по себестоимости учтён — переключатель включён и у компании есть склад (§5.3). */
    stock?: boolean;
    /** «Прибыль»: продаж «Нет партии» в периоде — себестоимость не определена (§5.3). */
    noBatch?: number;
  };
}

/** Операция в списке под отчётом: строка журнала и сумма строк, попавших в ячейку (в валюте счёта), если вошли не все. */
export interface CellItem extends JournalItem {
  part: number | null;
}

export interface CellPage {
  items: CellItem[];
  nextCursor: string | null;
}

export interface AnalyticsService {
  /** «Деньги / Cash flow» (§4.1). */
  cashflow(companyId: number, q: ReportQuery): ReportResponse;
  /** «Прибыль / P&L» (§5): по дате сделки, без переводов и исключённых категорий, склад — по q.stock. */
  pnl(companyId: number, q: ReportQuery): ReportResponse;
  /** Страница операций ячейки отчёта (§2.5): новые сверху, по 50. */
  operations(companyId: number, q: CellQuery): CellPage;
}

const idList = (ids: readonly number[]) => sql.join(ids.map((x) => sql`${x}`), sql`, `);
const has = (xs: readonly number[] | undefined): xs is number[] => !!xs && xs.length > 0;

/** Ошибка параметра отчёта — 400 с полем, как ошибки схемы. */
const invalid = (field: string, message: string) => new AppError(400, 'VALIDATION', 'Проверьте заполнение полей', { [field]: message });

/**
 * Период строк отчёта: моменты UTC [start; end) по paid_at; accrual — календарные даты [from; to] «Прибыли» (§3.1):
 * операция с датой сделки попадает по ней, без неё — по дню paid_at.
 */
export interface LineRange {
  start: string;
  end: string;
  accrual?: { from: string; to: string };
}

/**
 * Условие строк операций отчёта (§3.1) над `operation_lines l JOIN operations o`: фактические неудалённые доходы и расходы
 * компании за период (по paid_at или по дате сделки, LineRange). Категория и проект — условия строки, контрагент, теги и
 * счёт — операции. Внутри измерения «без …» объединяется с выбранными через ИЛИ (как фильтр журнала); родительская
 * категория включает подкатегории. drill — строка отчёта, по которой открыт список (§2.5).
 */
export function reportLineWhere(companyId: number, f: ReportFilter, range: LineRange, drill?: DrillSpec): SQL {
  const conds: SQL[] = [
    sql`o.company_id = ${companyId}`,
    sql`o.deleted_at IS NULL`,
    sql`o.status = 'actual'`,
    sql`o.type IN (${sql.join((drill?.types ?? ['income', 'expense']).map((t) => sql`${t}`), sql`, `)})`,
    range.accrual
      ? sql`((o.accrual_date IS NULL AND o.paid_at >= ${range.start} AND o.paid_at < ${range.end}) OR (o.accrual_date >= ${range.accrual.from} AND o.accrual_date <= ${range.accrual.to}))`
      : sql`o.paid_at >= ${range.start} AND o.paid_at < ${range.end}`,
  ];
  if (has(f.accountIds)) conds.push(sql`o.account_id IN (${idList(f.accountIds)})`);
  if (has(f.tagIds)) conds.push(sql`EXISTS (SELECT 1 FROM operation_tags ft WHERE ft.operation_id = o.id AND ft.tag_id IN (${idList(f.tagIds)}))`);
  const anyOf = (parts: (SQL | false)[]) => {
    const xs = parts.filter((p): p is SQL => !!p);
    if (xs.length) conds.push(sql`(${sql.join(xs, sql` OR `)})`);
  };
  const withChildren = (ids: readonly number[]) =>
    sql`l.category_id IN (SELECT c.id FROM categories c WHERE c.company_id = ${companyId} AND (c.id IN (${idList(ids)}) OR c.parent_id IN (${idList(ids)})))`;
  anyOf([has(f.categoryIds) && withChildren(f.categoryIds), !!f.withoutCategory && sql`l.category_id IS NULL`]);
  anyOf([has(f.counterpartyIds) && sql`o.counterparty_id IN (${idList(f.counterpartyIds)})`, !!f.withoutCounterparty && sql`o.counterparty_id IS NULL`]);
  anyOf([has(f.projectIds) && sql`l.project_id IN (${idList(f.projectIds)})`, !!f.withoutProject && sql`l.project_id IS NULL`]);
  if (drill?.dim) {
    const column = sql.raw(drill.dim === 'category' ? 'l.category_id' : drill.dim === 'project' ? 'l.project_id' : 'o.counterparty_id');
    if (drill.id === null) conds.push(sql`${column} IS NULL`);
    else if (drill.dim === 'category' && !drill.own) conds.push(withChildren([drill.id]));
    else conds.push(sql`${column} = ${drill.id}`);
  }
  return sql.join(conds, sql` AND `);
}

/**
 * Оплаты закупок, которые действуют (§5.3): неудалённые проведённые поступления компании — то же условие, что у долга
 * по документам в складе (unpaidDocs: type = 'receipt', deleted_at IS NULL, status = 'posted'). Удалённый расход
 * отсекает условие операций.
 *
 * Инвариант: оплатить закупку можно только расходом со счёта в базовой валюте компании (assertOperationPayments), поэтому
 * сумма оплаты уже в базовой валюте и сравнивается с base_amount строк расхода (в исключениях и частях ячейки).
 */
const livePayments = (companyId: number) =>
  sql`SELECT p.operation_id AS operationId, SUM(p.amount) AS paid FROM stock_doc_payments p JOIN stock_docs d ON d.id = p.doc_id
       WHERE d.company_id = ${companyId} AND d.deleted_at IS NULL AND d.type = 'receipt' AND d.status = 'posted' GROUP BY p.operation_id`;

export function createAnalyticsService(d: { db: Db; rates: RatesService; journal: JournalService; timezone: string; now?: () => Date }): AnalyticsService {
  const { db, timezone } = d;
  const now = d.now ?? (() => new Date());

  function dicts(companyId: number): ReportDicts {
    return {
      categories: db
        .select()
        .from(categories)
        .where(eq(categories.companyId, companyId))
        .orderBy(asc(categories.orderIndex), asc(categories.id))
        .all()
        .map((c) => ({ id: c.id, kind: c.kind, parentId: c.parentId, name: c.name, archived: c.archivedAt !== null, systemKey: c.systemKey as SystemKey | null })),
      counterparties: db
        .select()
        .from(counterparties)
        .where(eq(counterparties.companyId, companyId))
        .orderBy(asc(counterparties.orderIndex), asc(counterparties.id))
        .all()
        .map((c) => ({ id: c.id, name: c.name, archived: c.archivedAt !== null })),
      projects: db
        .select()
        .from(projects)
        .where(eq(projects.companyId, companyId))
        .orderBy(asc(projects.orderIndex), asc(projects.id))
        .all()
        .map((p) => ({ id: p.id, name: p.name, archived: p.archivedAt !== null })),
    };
  }

  /** Строки операций периода одним запросом (§3.2, шаг 1). */
  function selectLines(companyId: number, f: ReportFilter, range: LineRange): ReportLine[] {
    return db.all<ReportLine>(sql`
      SELECT o.paid_at AS at, o.type AS type, o.account_id AS accountId, l.category_id AS categoryId, l.project_id AS projectId,
             o.counterparty_id AS counterpartyId, l.base_amount AS amount
        FROM operation_lines l JOIN operations o ON o.id = l.operation_id
       WHERE ${reportLineWhere(companyId, f, range)}`);
  }

  /** Момент начала дня в APP_TIMEZONE с кэшем: дат сделки в отчёте — не больше дней периода. */
  function dayStarts() {
    const cache = new Map<string, string>();
    return (date: string) => {
      let at = cache.get(date);
      if (at === undefined) {
        at = startOfDayUtc(date, timezone);
        cache.set(date, at);
      }
      return at;
    };
  }

  /**
   * Строки «Прибыли» (§5.1): по дате сделки (момент начала её дня), без переводов. Со складом — без частей расходов,
   * оплативших поступления (§5.3): оплата делится по всем строкам операции (paymentExclusions), даже если фильтр
   * оставил только часть строк.
   */
  function selectPnlLines(companyId: number, f: ReportFilter, range: LineRange, stock: boolean): ReportLine[] {
    const rows = db.all<ReportLine & { lineId: number; accrual: string | null }>(sql`
      SELECT l.id AS lineId, o.paid_at AS at, o.accrual_date AS accrual, o.type AS type, o.account_id AS accountId, l.category_id AS categoryId,
             l.project_id AS projectId, o.counterparty_id AS counterpartyId, l.base_amount AS amount
        FROM operation_lines l JOIN operations o ON o.id = l.operation_id
       WHERE ${reportLineWhere(companyId, f, range)}`);
    const excluded = stock ? exclusions(companyId) : new Map<number, number>();
    const day = dayStarts();
    return rows.map((r) => ({
      at: r.accrual === null ? r.at : day(r.accrual),
      type: r.type,
      accountId: r.accountId,
      categoryId: r.categoryId,
      projectId: r.projectId,
      counterpartyId: r.counterpartyId,
      amount: r.amount - (excluded.get(r.lineId) ?? 0),
    }));
  }

  /** Расходы с оплатами закупок: id операции → сумма оплат и все её строки (base_amount) по порядку (§5.3). */
  function paidOperations(companyId: number, operationIds?: readonly number[]): Map<number, { paid: number; lines: { id: number; amount: number }[] }> {
    const ops = new Map<number, { paid: number; lines: { id: number; amount: number }[] }>();
    if (operationIds && operationIds.length === 0) return ops;
    const scope = operationIds ? sql`AND p.operationId IN (${idList(operationIds)})` : sql.empty();
    const rows = db.all<{ operationId: number; paid: number; lineId: number; amount: number }>(sql`
      SELECT p.operationId AS operationId, p.paid AS paid, l.id AS lineId, l.base_amount AS amount
        FROM (${livePayments(companyId)}) p
        JOIN operations o ON o.id = p.operationId AND o.company_id = ${companyId} AND o.type = 'expense'
        JOIN operation_lines l ON l.operation_id = o.id
       WHERE 1 = 1 ${scope}
       ORDER BY p.operationId, l.position, l.id`);
    for (const r of rows) {
      const op = ops.get(r.operationId) ?? { paid: Number(r.paid), lines: [] };
      op.lines.push({ id: r.lineId, amount: r.amount });
      ops.set(r.operationId, op);
    }
    return ops;
  }

  /** Исключаемые части строк расходов, оплативших поступления: id строки → сумма (§5.3). */
  function exclusions(companyId: number): Map<number, number> {
    return paymentExclusions([...paidOperations(companyId).values()]);
  }

  /** Склад компании для «Прибыли» (§5.3): себестоимость продаж и списаний по stock_allocations и продажи «Нет партии». */
  function stockInput(companyId: number, start: string, end: string): StockInput {
    const scope = sql`d.company_id = ${companyId} AND d.deleted_at IS NULL AND d.status = 'posted' AND d.at >= ${start} AND d.at < ${end}`;
    const costs = db.all<StockCost>(sql`
      SELECT d.at AS at, CASE WHEN d.type = 'sale' THEN 'cogs' ELSE 'writeoff' END AS kind, w.project_id AS projectId, SUM(a.cost) AS amount
        FROM stock_allocations a
        JOIN stock_doc_lines l ON l.id = a.line_id
        JOIN stock_docs d ON d.id = l.doc_id
        JOIN stock_warehouses w ON w.id = d.warehouse_id
       WHERE ${scope} AND d.type IN ('sale', 'writeoff', 'count') AND a.cost IS NOT NULL
       GROUP BY d.id`);
    const noBatch = db.all<{ at: string; projectId: number }>(sql`
      SELECT d.at AS at, w.project_id AS projectId
        FROM stock_docs d JOIN stock_warehouses w ON w.id = d.warehouse_id
       WHERE ${scope} AND d.type = 'sale'
         AND EXISTS (SELECT 1 FROM stock_doc_lines l JOIN stock_allocations a ON a.line_id = l.id WHERE l.doc_id = d.id AND a.batch_id IS NULL)`);
    return { costs: costs.map((c) => ({ ...c, amount: Number(c.amount) })), noBatch };
  }

  /** Склад учитывается: переключатель включён и у компании есть хоть один склад (архивный тоже — история). */
  const stockOn = (companyId: number, q: { stock: boolean }) =>
    q.stock && db.get<{ x: number }>(sql`SELECT 1 AS x FROM stock_warehouses WHERE company_id = ${companyId} LIMIT 1`) !== undefined;

  /** Счета компании; счёт фильтра не из этой компании — 400 «Неизвестный счёт» (§9). */
  function companyAccounts(companyId: number, f: ReportFilter) {
    const all = db.select().from(accounts).where(eq(accounts.companyId, companyId)).all();
    if (has(f.accountIds)) {
      const known = new Set(all.map((a) => a.id));
      if (f.accountIds.some((id) => !known.has(id))) throw invalid('accounts', 'Неизвестный счёт');
    }
    return all;
  }

  /**
   * Остатки набора счетов (§4.1): выбранные в фильтре «Счета» или все неархивные. Движения до периода — суммой по счёту,
   * внутри периода — по одному на операцию; курс — rates.resolve с кэшем. Каждая часть — один проход по операциям
   * (bench:reports): перевод даёт движение счёта списания, счёта зачисления и строку «Переводов» из одной строки выборки.
   */
  function balances(company: { id: number; baseCurrency: string }, all: (typeof accounts.$inferSelect)[], f: ReportFilter, columns: ReportColumn[], starts: string[]) {
    const chosen = all.filter((a) => (has(f.accountIds) ? f.accountIds.includes(a.id) : a.archivedAt === null));
    const set: BalanceAccount[] = chosen.map((a) => ({ id: a.id, currency: a.currency, startingBalance: a.startingBalance, openedAt: a.openedAt }));
    const accountIds = new Set(set.map((a) => a.id));
    const opening = new Map<number, number>();
    const legs: AccountLeg[] = [];
    const transfers: TransferLeg[] = [];
    if (set.length > 0 && columns.length > 0) {
      const ids = idList([...accountIds]);
      const start = starts[0]!;
      const end = starts.at(-1)!;
      const scope = sql`company_id = ${company.id} AND deleted_at IS NULL AND status = 'actual' AND (account_id IN (${ids}) OR to_account_id IN (${ids}))`;
      const add = (id: number, delta: number) => opening.set(id, (opening.get(id) ?? 0) + delta);
      for (const r of db.all<{ accountId: number; toAccountId: number | null; type: string; amount: number; toAmount: number | null }>(sql`
        SELECT account_id AS accountId, to_account_id AS toAccountId, type, SUM(amount) AS amount, SUM(to_amount) AS toAmount
          FROM operations WHERE ${scope} AND paid_at < ${start} GROUP BY account_id, to_account_id, type`)) {
        if (accountIds.has(r.accountId)) add(r.accountId, r.type === 'income' ? Number(r.amount) : -Number(r.amount));
        if (r.type === 'transfer' && r.toAccountId !== null && accountIds.has(r.toAccountId)) add(r.toAccountId, Number(r.toAmount));
      }
      for (const r of db.all<{ at: string; type: string; accountId: number; amount: number; toAccountId: number | null; toAmount: number | null; base: number }>(sql`
        SELECT paid_at AS at, type, account_id AS accountId, amount, to_account_id AS toAccountId, to_amount AS toAmount, base_amount AS base
          FROM operations WHERE ${scope} AND paid_at >= ${start} AND paid_at < ${end}`)) {
        if (accountIds.has(r.accountId)) legs.push({ at: r.at, accountId: r.accountId, delta: r.type === 'income' ? r.amount : -r.amount });
        if (r.type !== 'transfer' || r.toAccountId === null) continue;
        if (accountIds.has(r.toAccountId)) legs.push({ at: r.at, accountId: r.toAccountId, delta: r.toAmount ?? 0 });
        transfers.push({ at: r.at, from: r.accountId, to: r.toAccountId, base: r.base });
      }
    }
    const cache = new Map<string, Dec | null>();
    const rate = (currency: string, date: string): Dec | null => {
      const key = `${currency}|${date}`;
      if (!cache.has(key)) {
        try {
          cache.set(key, d.rates.resolve(company.id, company.baseCurrency, currency, date).rate);
        } catch (e) {
          if (!(e instanceof AppError && e.code === 'RATE_UNAVAILABLE')) throw e;
          cache.set(key, null);
        }
      }
      return cache.get(key)!;
    };
    const series = balanceSeries({
      columns,
      starts,
      accounts: set,
      opening,
      legs,
      transfers,
      baseCurrency: company.baseCurrency,
      rate,
      today: todayInTimezone(timezone, now()),
    });
    return { series, accountIds };
  }

  return {
    cashflow(companyId, q) {
      const company = requireCompany(db, companyId);
      const f = reportFilter(q);
      const columns = reportColumns(q.from, q.to, q.step);
      const starts = columnStarts(columns, timezone);
      const all = companyAccounts(companyId, f);
      const hidden = hidesBalances(f);
      const balance = hidden ? null : balances(company, all, f, columns, starts);
      const lines = selectLines(companyId, f, { start: starts[0]!, end: starts.at(-1)! });
      const { rows, empty } = cashflowRows({ columns, starts, lines, by: q.by, dicts: dicts(companyId), filter: f, balances: balance });
      return {
        columns,
        rows,
        meta: { from: q.from, to: q.to, step: q.step, by: q.by, currency: company.baseCurrency, empty, balancesHidden: hidden },
      };
    },

    pnl(companyId, q) {
      const company = requireCompany(db, companyId);
      const f = reportFilter(q);
      companyAccounts(companyId, f);
      const columns = reportColumns(q.from, q.to, q.step);
      const starts = columnStarts(columns, timezone);
      const stock = stockOn(companyId, q);
      const range: LineRange = { start: starts[0]!, end: starts.at(-1)!, accrual: { from: q.from, to: q.to } };
      const lines = selectPnlLines(companyId, f, range, stock);
      const result = pnlRows({ columns, starts, lines, by: q.by, dicts: dicts(companyId), filter: f, stock: stock ? stockInput(companyId, range.start, range.end) : null });
      return {
        columns,
        rows: result.rows,
        meta: { from: q.from, to: q.to, step: q.step, by: q.by, currency: company.baseCurrency, empty: result.empty, balancesHidden: false, stock, noBatch: result.noBatch },
      };
    },

    operations(companyId, q) {
      requireCompany(db, companyId);
      companyAccounts(companyId, reportFilter(q));
      const range = drillRange(reportColumns(q.from, q.to, q.step), q.col);
      if (!range) throw invalid('col', 'Неизвестная колонка');
      const drill = parseDrillRow(q.row)!;
      const pnl = q.report === 'pnl';
      const bounds: LineRange = {
        start: startOfDayUtc(range.from, timezone),
        end: startOfDayUtc(addDays(range.to, 1), timezone),
        ...(pnl ? { accrual: range } : {}),
      };
      const where = [reportLineWhere(companyId, reportFilter(q), bounds, drill)];
      const stock = pnl && stockOn(companyId, q);
      if (pnl) {
        // «Прибыль» (§5.1): строки исключённых системных категорий не входят
        const excluded = [...pnlExcludedCategories(dicts(companyId).categories)];
        if (excluded.length) where.push(sql`(l.category_id IS NULL OR l.category_id NOT IN (${idList(excluded)}))`);
      }
      // строки операции, попавшие в ячейку: сумма в валюте счёта; «часть операции» — если вошли не все строки
      const page = (after: { v: string | number; id: number } | null, size: number) =>
        db.all<{ id: number; paidAt: string; part: number; matched: number; lines: number; lineIds: string }>(sql`
        SELECT o.id AS id, o.paid_at AS paidAt, SUM(l.amount) AS part, COUNT(*) AS matched, GROUP_CONCAT(l.id) AS lineIds,
               (SELECT COUNT(*) FROM operation_lines x WHERE x.operation_id = o.id) AS lines
          FROM operation_lines l JOIN operations o ON o.id = l.operation_id
         WHERE ${sql.join(after ? [...where, sql`(o.paid_at, o.id) < (${after.v}, ${after.id})`] : where, sql` AND `)}
         GROUP BY o.id
         ORDER BY o.paid_at DESC, o.id DESC
         LIMIT ${size}`);
      // «Прибыль» со складом (R1): расход, целиком оплативший закупки, в ячейку не входит — решает isFullyPaid, то же правило
      // исключений по всем строкам расхода, что и в отчёте (расход с отрицательной строкой оплаченным не считается). Решение
      // принимается после выборки, поэтому страница добирается порциями, пока не наберётся лимит.
      type Found = ReturnType<typeof page>[number];
      const kept: { row: Found; cut: number }[] = [];
      let after: { v: string | number; id: number } | null = q.cursor ? decodeCursor(q.cursor, 'date', 'desc') : null;
      for (let exhausted = false; !exhausted && kept.length <= q.limit; ) {
        const found = page(after, q.limit + 1);
        exhausted = found.length < q.limit + 1;
        const paid = stock ? paidOperations(companyId, found.map((r) => r.id)) : new Map<number, { paid: number; lines: { id: number; amount: number }[] }>();
        for (const row of found) {
          if (kept.length > q.limit) break;
          const op = paid.get(row.id);
          const matched = new Set(row.lineIds.split(',').map(Number));
          if (op && isFullyPaid(op, matched)) continue;
          const cuts = op ? paymentExclusions([op]) : new Map<number, number>();
          kept.push({ row, cut: [...matched].reduce((s, id) => s + (cuts.get(id) ?? 0), 0) });
        }
        const last = found.at(-1);
        if (last) after = { v: last.paidAt, id: last.id };
      }
      const more = kept.length > q.limit;
      const rows = more ? kept.slice(0, q.limit) : kept;
      // часть строки, оплатившая закупку, в ячейку не входит (§5.3) — сумма без неё и пометка части; оплаты только со счетов
      // в базовой валюте, поэтому срез (base_amount) и сумма в валюте счёта совпадают
      const parts = new Map(rows.map(({ row, cut }) => [row.id, row.matched < row.lines || cut > 0 ? Number(row.part) - cut : null]));
      const last = rows.at(-1)?.row;
      return {
        items: d.journal.load(companyId, rows.map(({ row }) => row.id)).map((item) => ({ ...item, part: parts.get(item.id) ?? null })),
        nextCursor: more && last ? encodeCursor({ s: 'date', o: 'desc', v: last.paidAt, id: last.id }) : null,
      };
    },
  };
}
