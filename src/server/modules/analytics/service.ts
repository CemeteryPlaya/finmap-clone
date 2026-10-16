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
import { reportFilter, type CellQuery, type ReportQuery } from '../../../shared/schemas/analytics';
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
  /** Страница операций ячейки отчёта (§2.5): новые сверху, по 50. */
  operations(companyId: number, q: CellQuery): CellPage;
}

const idList = (ids: readonly number[]) => sql.join(ids.map((x) => sql`${x}`), sql`, `);
const has = (xs: readonly number[] | undefined): xs is number[] => !!xs && xs.length > 0;

/** Ошибка параметра отчёта — 400 с полем, как ошибки схемы. */
const invalid = (field: string, message: string) => new AppError(400, 'VALIDATION', 'Проверьте заполнение полей', { [field]: message });

/**
 * Условие строк операций отчёта (§3.1) над `operation_lines l JOIN operations o`: фактические неудалённые доходы и расходы
 * компании с paid_at в [start; end). Категория и проект — условия строки, контрагент, теги и счёт — операции.
 * Внутри измерения «без …» объединяется с выбранными через ИЛИ (как фильтр журнала); родительская категория включает
 * подкатегории. drill — строка отчёта, по которой открыт список (§2.5).
 */
export function reportLineWhere(companyId: number, f: ReportFilter, range: { start: string; end: string }, drill?: DrillSpec): SQL {
  const conds: SQL[] = [
    sql`o.company_id = ${companyId}`,
    sql`o.deleted_at IS NULL`,
    sql`o.status = 'actual'`,
    sql`o.type IN (${sql.join((drill?.types ?? ['income', 'expense']).map((t) => sql`${t}`), sql`, `)})`,
    sql`o.paid_at >= ${range.start}`,
    sql`o.paid_at < ${range.end}`,
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
        .map((c) => ({ id: c.id, kind: c.kind, parentId: c.parentId, name: c.name, archived: c.archivedAt !== null })),
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
  function selectLines(companyId: number, f: ReportFilter, range: { start: string; end: string }): ReportLine[] {
    return db.all<ReportLine>(sql`
      SELECT o.paid_at AS at, o.type AS type, o.account_id AS accountId, l.category_id AS categoryId, l.project_id AS projectId,
             o.counterparty_id AS counterpartyId, l.base_amount AS amount
        FROM operation_lines l JOIN operations o ON o.id = l.operation_id
       WHERE ${reportLineWhere(companyId, f, range)}`);
  }

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
   * Остатки набора счетов (§4.1): выбранные в фильтре «Счета» или все неархивные. Движения до
   * периода — суммой по счёту, внутри периода — по одному на операцию; курс — rates.resolve с кэшем.
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
      const scope = sql`company_id = ${company.id} AND deleted_at IS NULL AND status = 'actual'`;
      for (const r of db.all<{ accountId: number; delta: number }>(sql`
        SELECT account_id AS accountId, SUM(CASE WHEN type = 'income' THEN amount ELSE -amount END) AS delta
          FROM operations WHERE ${scope} AND paid_at < ${start} AND account_id IN (${ids}) GROUP BY account_id
        UNION ALL
        SELECT to_account_id, SUM(to_amount)
          FROM operations WHERE ${scope} AND type = 'transfer' AND paid_at < ${start} AND to_account_id IN (${ids}) GROUP BY to_account_id`)) {
        opening.set(r.accountId, (opening.get(r.accountId) ?? 0) + Number(r.delta));
      }
      legs.push(
        ...db.all<AccountLeg>(sql`
          SELECT paid_at AS at, account_id AS accountId, CASE WHEN type = 'income' THEN amount ELSE -amount END AS delta
            FROM operations WHERE ${scope} AND paid_at >= ${start} AND paid_at < ${end} AND account_id IN (${ids})
          UNION ALL
          SELECT paid_at, to_account_id, to_amount
            FROM operations WHERE ${scope} AND type = 'transfer' AND paid_at >= ${start} AND paid_at < ${end} AND to_account_id IN (${ids})`),
      );
      transfers.push(
        ...db.all<TransferLeg>(sql`
          SELECT paid_at AS at, account_id AS "from", to_account_id AS "to", base_amount AS base
            FROM operations
           WHERE ${scope} AND type = 'transfer' AND paid_at >= ${start} AND paid_at < ${end} AND (account_id IN (${ids}) OR to_account_id IN (${ids}))`),
      );
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

    operations(companyId, q) {
      requireCompany(db, companyId);
      companyAccounts(companyId, reportFilter(q));
      const range = drillRange(reportColumns(q.from, q.to, q.step), q.col);
      if (!range) throw invalid('col', 'Неизвестная колонка');
      const drill = parseDrillRow(q.row)!;
      const where = [reportLineWhere(companyId, reportFilter(q), { start: startOfDayUtc(range.from, timezone), end: startOfDayUtc(addDays(range.to, 1), timezone) }, drill)];
      if (q.cursor) {
        const c = decodeCursor(q.cursor, 'date', 'desc');
        where.push(sql`(o.paid_at, o.id) < (${c.v}, ${c.id})`);
      }
      // строки операции, попавшие в ячейку: сумма в валюте счёта; «часть операции» — если вошли не все строки
      const found = db.all<{ id: number; paidAt: string; part: number; matched: number; lines: number }>(sql`
        SELECT o.id AS id, o.paid_at AS paidAt, SUM(l.amount) AS part, COUNT(*) AS matched,
               (SELECT COUNT(*) FROM operation_lines x WHERE x.operation_id = o.id) AS lines
          FROM operation_lines l JOIN operations o ON o.id = l.operation_id
         WHERE ${sql.join(where, sql` AND `)}
         GROUP BY o.id
         ORDER BY o.paid_at DESC, o.id DESC
         LIMIT ${q.limit + 1}`);
      const more = found.length > q.limit;
      const rows = more ? found.slice(0, q.limit) : found;
      const parts = new Map(rows.map((r) => [r.id, r.matched < r.lines ? Number(r.part) : null]));
      const last = rows.at(-1);
      return {
        items: d.journal.load(companyId, rows.map((r) => r.id)).map((item) => ({ ...item, part: parts.get(item.id) ?? null })),
        nextCursor: more && last ? encodeCursor({ s: 'date', o: 'desc', v: last.paidAt, id: last.id }) : null,
      };
    },
  };
}
