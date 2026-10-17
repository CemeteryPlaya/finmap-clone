import { and, asc, eq, sql, type SQL } from 'drizzle-orm';
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
  type LineType,
  type ReportColumn,
  type ReportDicts,
  type ReportFilter,
  type ReportLine,
  type ReportRow,
  type TransferLeg,
} from '../../../shared/report-engine';
import {
  defaultPart,
  INDICATOR_EXPENSE,
  INDICATOR_PARTS,
  indicatorRows,
  PART_KIND,
  PART_LABEL,
  partCategories,
  partText,
  templateCategoryIds,
  type IndicatorKey,
  type IndicatorLine,
  type IndicatorPart,
  type IndicatorRow,
  type PartConfig,
} from '../../../shared/report-indicators';
import { isFullyPaid, paymentExclusions, pnlExcludedCategories, pnlRows, type PaidOperation, type StockCost, type StockInput } from '../../../shared/report-pnl';
import { MODE_LABEL, parseProjectsRow, projectsRows, STATUS_LABEL, type ProjectRow, type ProjectsCol, type ProjectsMode, type ProjectStatus } from '../../../shared/report-projects';
import { statementDelta, statementSummary, transferLabel, type StatementSummary } from '../../../shared/report-statement';
import {
  reportFilter,
  type CellQuery,
  type IndicatorPartInput,
  type IndicatorsQuery,
  type ProjectsQuery,
  type ReportExportQuery,
  type ReportKind,
  type ReportQuery,
  type StatementExportQuery,
  type StatementQuery,
} from '../../../shared/schemas/analytics';
import type { SystemKey } from '../../../shared/system-categories';
import { TEMPLATES } from '../../../templates';
import type { Db } from '../../db/client';
import { accounts, analyticsIndicatorParts, categories, counterparties, projects, tags } from '../../db/schema';
import { AppError } from '../../errors';
import { exportFileName } from '../../http/export-name';
import { buildXlsx } from '../../http/xlsx';
import { mutate } from '../audit/mutate';
import { createAuditService, type AuditService } from '../audit/service';
import { requireCompany } from '../companies/guard';
import { decodeCursor, encodeCursor, JOURNAL_EXPORT_MAX, type JournalItem, type JournalService } from '../operations/journal';
import type { RatesService } from '../rates/service';
import { filterText, indicatorsSheet, projectsSheet, reportInfo, reportSheet, statementSheet, type FilterNames, type StatementExportRow } from './report-export';

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

/** «Проекты» (§7): строки проектов, «Всего» и сведения о расчёте; суммы — в базовой валюте компании. */
export interface ProjectsResponse {
  rows: ProjectRow[];
  total: ProjectRow;
  meta: {
    from: string;
    to: string;
    status: ProjectStatus;
    mode: ProjectsMode;
    currency: string;
    /** В периоде нет ни строк операций, ни себестоимости склада. */
    empty: boolean;
    /** Склад по себестоимости учтён: переключатель включён и у компании есть склад (§5.3). */
    stock: boolean;
    /** Продаж «Нет партии» в периоде (§5.3). */
    noBatch: number;
  };
}

/** Счёт выписки (§6). */
export interface StatementAccount {
  id: number;
  name: string;
  currency: string;
  archived: boolean;
  /** Дата открытия счёта (ГГГГ-ММ-ДД): открыт внутри периода — Excel выписки говорит об этом строкой (R2). */
  openedAt: string;
}

/** Страница операций выписки: строки журнала (с остатками после операции), новые сверху. */
export interface StatementPage {
  items: JournalItem[];
  nextCursor: string | null;
}

/** «Выписка по счету» (§6, §9): счёт, сводка в его валюте и первая страница операций. */
export interface StatementResponse extends StatementPage {
  account: StatementAccount;
  summary: StatementSummary;
  meta: { from: string; to: string };
}

/** Часть показателя в ответе (§8.2): действующая настройка и признак умолчания (строки настройки нет). */
export interface IndicatorPartView extends PartConfig {
  isDefault: boolean;
}

/** «Финансовые показатели» (§8.1): колонки шага, четыре показателя, действующие настройки частей и сведения о расчёте. */
export interface IndicatorsResponse {
  columns: ReportColumn[];
  rows: IndicatorRow[];
  parts: Record<IndicatorPart, IndicatorPartView>;
  meta: {
    from: string;
    to: string;
    step: IndicatorsQuery['step'];
    currency: string;
    /** Ни строк «Прибыли», ни себестоимости склада в периоде. */
    empty: boolean;
    /** У компании есть склад: флажок склада частей действует (§5.3). */
    stock: boolean;
    /** Продаж «Нет партии» в периоде (§5.3). */
    noBatch: number;
  };
}

export interface AnalyticsService {
  /** «Деньги / Cash flow» (§4.1). */
  cashflow(companyId: number, q: ReportQuery): ReportResponse;
  /** «Прибыль / P&L» (§5): по дате сделки, без переводов и исключённых категорий, склад — по q.stock. */
  pnl(companyId: number, q: ReportQuery): ReportResponse;
  /** «Проекты» (§7): по правилам «Прибыли» — дата сделки, исключения, склад по q.stock; статус и режим. */
  projects(companyId: number, q: ProjectsQuery): ProjectsResponse;
  /** Excel «Проектов» (§2.6, §7): таблица как на экране, с категориями в режиме «Проекты с категориями». */
  projectsXlsx(companyId: number, q: ProjectsQuery): { fileName: string; data: Buffer };
  /** Страница операций ячейки отчёта (§2.5): новые сверху, по 50. */
  operations(companyId: number, q: CellQuery): CellPage;
  /** Excel отчёта (§2.6): таблица как на экране, все строки раскрыты; «{Компания} - {Отчёт} - ДД-ММ-ГГГГ ЧЧ-ММ.xlsx». */
  exportXlsx(companyId: number, report: ReportKind, q: ReportExportQuery): { fileName: string; data: Buffer };
  /** «Финансовые показатели» (§8.1): по правилам «Прибыли», части — настройка компании или умолчание (§8.2). */
  indicators(companyId: number, q: IndicatorsQuery): IndicatorsResponse;
  /** Excel «Финансовых показателей» (§2.6): таблица как на экране и настройки частей. */
  indicatorsXlsx(companyId: number, q: IndicatorsQuery): { fileName: string; data: Buffer };
  /** Сохранить часть показателя (§8.2) и записать изменение в историю; архивная компания — только чтение. */
  savePart(companyId: number, part: IndicatorPart, input: IndicatorPartInput, userId: number): Record<IndicatorPart, IndicatorPartView>;
  /** «Вернуть по умолчанию» (§8.2): удалить настройку части; без настройки — ничего не меняется и не пишется. */
  resetPart(companyId: number, part: IndicatorPart, userId: number): Record<IndicatorPart, IndicatorPartView>;
  /** «Выписка по счету» (§6): сводка за период в валюте счёта и первая страница операций, новые сверху. */
  statement(companyId: number, q: StatementQuery): StatementResponse;
  /** Следующие страницы операций выписки (курсор журнала). */
  statementOperations(companyId: number, q: StatementQuery): StatementPage;
  /** Excel выписки (§2.6, §6): сводка и все операции периода, как на экране. */
  statementXlsx(companyId: number, q: StatementExportQuery): { fileName: string; data: Buffer };
}

/** Названия отчётов в имени файла и листа Excel. */
const REPORT_TITLE: Record<ReportKind, string> = { cashflow: 'Деньги', pnl: 'Прибыль' };

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

export function createAnalyticsService(d: {
  db: Db;
  rates: RatesService;
  journal: JournalService;
  timezone: string;
  now?: () => Date;
  exportLimit?: number;
  /** История изменений настроек показателей (§8.2). */
  audit?: AuditService;
}): AnalyticsService {
  const { db, timezone } = d;
  const exportLimit = d.exportLimit ?? JOURNAL_EXPORT_MAX;
  const now = d.now ?? (() => new Date());
  const audit = d.audit ?? createAuditService(db, now);

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
   * Строки по дате сделки (§3.1): момент начала её дня, без переводов. cut — часть строки расхода, оплатившая поступления
   * склада (§5.3), когда stock: оплата делится по всем строкам операции (paymentExclusions), даже если фильтр оставил
   * только часть строк. Без склада cut — 0.
   */
  function selectDealLines(companyId: number, f: ReportFilter, range: LineRange, stock: boolean): IndicatorLine[] {
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
      amount: r.amount,
      cut: excluded.get(r.lineId) ?? 0,
    }));
  }

  /** Строки «Прибыли» (§5.1): строки по дате сделки, со складом — без частей расходов, оплативших поступления (§5.3). */
  function selectPnlLines(companyId: number, f: ReportFilter, range: LineRange, stock: boolean): ReportLine[] {
    return selectDealLines(companyId, f, range, stock).map(({ cut, ...l }) => ({ ...l, amount: l.amount - cut }));
  }

  /** Категории компании из умолчаний шаблонов (§8.2): по ссылке шаблона, у «Общего» их нет. */
  function templateDefaults(companyId: number): { cogs: number[]; variable: number[] } {
    const rows = db
      .select({ id: categories.id, templateRef: categories.templateRef })
      .from(categories)
      .where(eq(categories.companyId, companyId))
      .orderBy(asc(categories.orderIndex), asc(categories.id))
      .all();
    const refs = (key: 'cogs' | 'variable') => TEMPLATES.flatMap((t) => t.indicatorDefaults?.[key] ?? []);
    return { cogs: templateCategoryIds(rows, refs('cogs')), variable: templateCategoryIds(rows, refs('variable')) };
  }

  /** Действующие настройки частей (§8.2): сохранённая строка или умолчание. */
  function partViews(companyId: number): Record<IndicatorPart, IndicatorPartView> {
    const saved = new Map(
      db
        .select()
        .from(analyticsIndicatorParts)
        .where(eq(analyticsIndicatorParts.companyId, companyId))
        .all()
        .map((r) => [r.part, r]),
    );
    const template = templateDefaults(companyId);
    const out = {} as Record<IndicatorPart, IndicatorPartView>;
    for (const part of INDICATOR_PARTS) {
      const row = saved.get(part);
      out[part] = row
        ? { allCategories: row.allCategories, categoryIds: JSON.parse(row.categoryIds) as number[], includeStock: row.includeStock, isDefault: false }
        : { ...defaultPart(part, template), isDefault: true };
    }
    return out;
  }

  /** Запись истории о части (§8.2): названия категорий на момент изменения — история читается и после их удаления. */
  function partDiff(part: IndicatorPart, v: IndicatorPartView, names: Map<number, string>) {
    const categories = v.allCategories ? [] : v.categoryIds.map((id) => names.get(id)).filter((n): n is string => n !== undefined);
    return { allCategories: v.allCategories, categories, includeStock: v.includeStock, isDefault: v.isDefault, text: partText(part, v, categories) };
  }

  /** Расходы с оплатами закупок: id операции → сумма оплат и все её строки (base_amount) по порядку (§5.3). */
  function paidOperations(companyId: number, operationIds?: readonly number[]): Map<number, PaidOperation> {
    const ops = new Map<number, PaidOperation>();
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
      const op = ops.get(r.operationId);
      const line = { id: r.lineId, amount: r.amount };
      ops.set(r.operationId, op ? { paid: op.paid, lines: [...op.lines, line] } : { paid: Number(r.paid), lines: [line] });
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

  /** Границы периода «Прибыли» и «Проектов» (§3.1): моменты дня в APP_TIMEZONE и календарные даты для даты сделки. */
  const dealRange = (q: { from: string; to: string }): LineRange => ({
    start: startOfDayUtc(q.from, timezone),
    end: startOfDayUtc(addDays(q.to, 1), timezone),
    accrual: { from: q.from, to: q.to },
  });

  /**
   * Условие строк ячейки «Проектов» (§7): колонка — доходы, расходы или все строки (прибыль и проценты); строка — проект,
   * «Без проекта», проекты статуса вместе или все («Всего») и, в «Проектах с категориями», категория с подкатегориями.
   */
  function projectsCellWhere(companyId: number, f: ReportFilter, bounds: LineRange, row: string, col: ProjectsCol): SQL[] {
    const spec = parseProjectsRow(row)!;
    const types: LineType[] = col === 'total' ? ['income', 'expense'] : [col];
    const drill: DrillSpec = spec.category === undefined ? { types, dim: null, id: null, own: false } : { types, dim: 'category', id: spec.category, own: false };
    const where = [reportLineWhere(companyId, f, bounds, drill)];
    if (spec.project === null) where.push(sql`l.project_id IS NULL`);
    else if (typeof spec.project === 'number') where.push(sql`l.project_id = ${spec.project}`);
    else if (spec.project !== 'any') {
      const archived = sql.raw(spec.project === 'archived' ? 'IS NOT NULL' : 'IS NULL');
      where.push(sql`l.project_id IN (SELECT p.id FROM projects p WHERE p.company_id = ${companyId} AND p.archived_at ${archived})`);
    }
    return where;
  }

  /**
   * Условие строк ячейки показателя (§8.1): доходы категорий «Выручки» и расходы категорий его части расходов; «Процент
   * маржи» — все строки «Прибыли». stock — у части расходов включён склад (у «Процента маржи» — как у «Прибыли»).
   */
  function indicatorCellWhere(companyId: number, key: IndicatorKey): { where: SQL; stock: boolean } {
    const expensePart = INDICATOR_EXPENSE[key];
    if (expensePart === null) return { where: sql`1 = 1`, stock: true };
    const parts = partViews(companyId);
    const cats = dicts(companyId).categories;
    const side = (part: IndicatorPart) => {
      const set = partCategories(part, parts[part], cats);
      const conds = [...(set.ids.size > 0 ? [sql`l.category_id IN (${idList([...set.ids])})`] : []), ...(set.uncategorized ? [sql`l.category_id IS NULL`] : [])];
      return conds.length > 0 ? sql`(o.type = ${PART_KIND[part]} AND (${sql.join(conds, sql` OR `)}))` : sql`0 = 1`;
    };
    return { where: sql`(${side('revenue')} OR ${side(expensePart)})`, stock: parts[expensePart].includeStock };
  }

  /** Названия выбранных значений фильтров для сведений Excel (R13). */
  function filterNames(companyId: number, f: ReportFilter): FilterNames {
    const dict = dicts(companyId);
    const names = (ids: readonly number[] | undefined, items: readonly { id: number; name: string }[]) =>
      (ids ?? []).map((id) => items.find((i) => i.id === id)?.name).filter((n): n is string => n !== undefined);
    return {
      accounts: names(f.accountIds, db.select().from(accounts).where(eq(accounts.companyId, companyId)).all()),
      categories: names(f.categoryIds, dict.categories),
      counterparties: names(f.counterpartyIds, dict.counterparties),
      projects: names(f.projectIds, dict.projects),
      tags: names(f.tagIds, db.select().from(tags).where(eq(tags.companyId, companyId)).all()),
      withoutCategory: f.withoutCategory === true,
      withoutCounterparty: f.withoutCounterparty === true,
      withoutProject: f.withoutProject === true,
    };
  }

  /** Счёт выписки — любой счёт компании, архивный тоже; чужой или несуществующий — 400 «Неизвестный счёт» (§9). */
  function statementAccount(companyId: number, accountId: number): StatementAccount {
    const a = db
      .select()
      .from(accounts)
      .where(and(eq(accounts.companyId, companyId), eq(accounts.id, accountId)))
      .get();
    if (!a) throw invalid('account', 'Неизвестный счёт');
    return { id: a.id, name: a.name, currency: a.currency, archived: a.archivedAt !== null, openedAt: a.openedAt };
  }

  /**
   * Операции выписки (§6): фактические неудалённые операции компании, где счёт — счёт списания или зачисления, с моментом
   * платежа в периоде — календарные дни в APP_TIMEZONE.
   */
  function statementWhere(companyId: number, accountId: number, q: { from: string; to: string }): SQL {
    const start = startOfDayUtc(q.from, timezone);
    const end = startOfDayUtc(addDays(q.to, 1), timezone);
    return sql`o.company_id = ${companyId} AND o.deleted_at IS NULL AND o.status = 'actual' AND (o.account_id = ${accountId} OR o.to_account_id = ${accountId})
      AND o.paid_at >= ${start} AND o.paid_at < ${end}`;
  }

  /**
   * Сводка выписки (§6) в валюте счёта. Остаток на начало — как «Остаток после операции» журнала (§4.7): стартовый
   * остаток счёта плюс все движения до начала периода (дата открытия счёта на остаток не влияет). Остаток на конец —
   * начало плюс обороты периода (statementSummary), поэтому он равен остатку после последней операции периода.
   */
  function statementTotals(companyId: number, account: StatementAccount, q: { from: string; to: string }): StatementSummary {
    const id = account.id;
    const before = db.get<{ starting: number; delta: number | null }>(sql`
      SELECT (SELECT starting_balance FROM accounts WHERE id = ${id}) AS starting,
             SUM(CASE WHEN o.account_id = ${id} THEN (CASE WHEN o.type = 'income' THEN o.amount ELSE -o.amount END) ELSE 0 END
               + CASE WHEN o.type = 'transfer' AND o.to_account_id = ${id} THEN o.to_amount ELSE 0 END) AS delta
        FROM operations o
       WHERE o.company_id = ${companyId} AND o.deleted_at IS NULL AND o.status = 'actual'
         AND (o.account_id = ${id} OR o.to_account_id = ${id}) AND o.paid_at < ${startOfDayUtc(q.from, timezone)}`)!;
    const t = db.get<{ income: number | null; expense: number | null; transfersIn: number | null; transfersOut: number | null }>(sql`
      SELECT SUM(CASE WHEN o.type = 'income' THEN o.amount END) AS income,
             SUM(CASE WHEN o.type = 'expense' THEN o.amount END) AS expense,
             SUM(CASE WHEN o.type = 'transfer' AND o.to_account_id = ${id} THEN o.to_amount END) AS transfersIn,
             SUM(CASE WHEN o.type = 'transfer' AND o.account_id = ${id} THEN o.amount END) AS transfersOut
        FROM operations o
       WHERE ${statementWhere(companyId, id, q)}`)!;
    return statementSummary(Number(before.starting) + Number(before.delta ?? 0), {
      income: Number(t.income ?? 0),
      expense: Number(t.expense ?? 0),
      transfersIn: Number(t.transfersIn ?? 0),
      transfersOut: Number(t.transfersOut ?? 0),
    });
  }

  /** Страница операций выписки: новые сверху по (paid_at, id), курсор журнала; строки — JournalService.load с остатками. */
  function statementPage(companyId: number, accountId: number, q: StatementQuery): StatementPage {
    const conds = [statementWhere(companyId, accountId, q)];
    if (q.cursor) {
      const c = decodeCursor(q.cursor, 'date', 'desc');
      conds.push(sql`(o.paid_at, o.id) < (${c.v}, ${c.id})`);
    }
    const found = db.all<{ id: number; paidAt: string }>(sql`
      SELECT o.id AS id, o.paid_at AS paidAt FROM operations o WHERE ${sql.join(conds, sql` AND `)} ORDER BY o.paid_at DESC, o.id DESC LIMIT ${q.limit + 1}`);
    const more = found.length > q.limit;
    const rows = more ? found.slice(0, q.limit) : found;
    const last = rows.at(-1);
    return {
      items: d.journal.load(companyId, rows.map((r) => r.id)),
      nextCursor: more && last ? encodeCursor({ s: 'date', o: 'desc', v: last.paidAt, id: last.id }) : null,
    };
  }

  /**
   * Строки Excel выписки: все операции периода, новые сверху, как на экране. Остаток после операции — остаток на начало
   * плюс движения по порядку (paid_at, id): тот же порядок, что у остатка журнала (§4.7). Категория — полные названия
   * строк («Родитель → Дочерняя») через «; », у перевода — «Перевод: {другой счёт}».
   */
  function statementRows(companyId: number, accountId: number, q: { from: string; to: string }, start: number): StatementExportRow[] {
    const where = statementWhere(companyId, accountId, q);
    const ops = db.all<{
      id: number;
      type: 'income' | 'expense' | 'transfer';
      paidAt: string;
      accountId: number;
      toAccountId: number | null;
      amount: number;
      toAmount: number | null;
      counterpartyId: number | null;
      comment: string | null;
    }>(sql`
      SELECT o.id AS id, o.type AS type, o.paid_at AS paidAt, o.account_id AS accountId, o.to_account_id AS toAccountId, o.amount AS amount,
             o.to_amount AS toAmount, o.counterparty_id AS counterpartyId, o.comment AS comment
        FROM operations o WHERE ${where} ORDER BY o.paid_at, o.id`);
    const lines = new Map<number, { categoryId: number | null; projectId: number | null }[]>();
    for (const l of db.all<{ operationId: number; categoryId: number | null; projectId: number | null }>(sql`
      SELECT l.operation_id AS operationId, l.category_id AS categoryId, l.project_id AS projectId
        FROM operation_lines l JOIN operations o ON o.id = l.operation_id
       WHERE ${where} ORDER BY l.operation_id, l.position`)) {
      lines.set(l.operationId, [...(lines.get(l.operationId) ?? []), l]);
    }
    const dict = dicts(companyId);
    const categoryById = new Map(dict.categories.map((c) => [c.id, c]));
    const categoryName = (id: number | null) => {
      const c = id === null ? undefined : categoryById.get(id);
      if (!c) return null;
      const parent = c.parentId === null ? undefined : categoryById.get(c.parentId);
      return parent ? `${parent.name} → ${c.name}` : c.name;
    };
    const projectName = new Map(dict.projects.map((p) => [p.id, p.name]));
    const counterpartyName = new Map(dict.counterparties.map((c) => [c.id, c.name]));
    const accountName = new Map(db.select().from(accounts).where(eq(accounts.companyId, companyId)).all().map((a) => [a.id, a.name]));
    const joined = (xs: (string | null | undefined)[]) => [...new Set(xs.filter((x): x is string => !!x))].join('; ') || null;
    let balance = start;
    const rows = ops.map((o): StatementExportRow => {
      const delta = statementDelta(o, accountId);
      balance += delta;
      const own = lines.get(o.id) ?? [];
      const other = o.accountId === accountId ? o.toAccountId : o.accountId;
      return {
        paidAt: o.paidAt,
        delta,
        balance,
        counterparty: o.counterpartyId === null ? null : (counterpartyName.get(o.counterpartyId) ?? null),
        category: o.type === 'transfer' ? transferLabel(other === null ? '…' : (accountName.get(other) ?? '…')) : joined(own.map((l) => categoryName(l.categoryId) ?? 'Без категории')) ?? 'Без категории',
        project: joined(own.map((l) => (l.projectId === null ? null : projectName.get(l.projectId)))),
        comment: o.comment,
      };
    });
    return rows.reverse();
  }

  const service: AnalyticsService = {
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
      // те же границы, что у «Проектов»: итоги «Проектов» равны итогам «Прибыли» (§7)
      const range = dealRange(q);
      const lines = selectPnlLines(companyId, f, range, stock);
      const result = pnlRows({ columns, starts, lines, by: q.by, dicts: dicts(companyId), filter: f, stock: stock ? stockInput(companyId, range.start, range.end) : null });
      return {
        columns,
        rows: result.rows,
        meta: { from: q.from, to: q.to, step: q.step, by: q.by, currency: company.baseCurrency, empty: result.empty, balancesHidden: false, stock, noBatch: result.noBatch },
      };
    },

    projects(companyId, q) {
      const company = requireCompany(db, companyId);
      const f = reportFilter(q);
      companyAccounts(companyId, f);
      const range = dealRange(q);
      const stock = stockOn(companyId, q);
      const result = projectsRows({
        lines: selectPnlLines(companyId, f, range, stock),
        dicts: dicts(companyId),
        filter: f,
        status: q.status,
        mode: q.mode,
        stock: stock ? stockInput(companyId, range.start, range.end) : null,
      });
      return {
        rows: result.rows,
        total: result.total,
        meta: { from: q.from, to: q.to, status: q.status, mode: q.mode, currency: company.baseCurrency, empty: result.empty, stock, noBatch: result.noBatch },
      };
    },

    projectsXlsx(companyId, q) {
      const company = requireCompany(db, companyId);
      const data = service.projects(companyId, q);
      const info = reportInfo({
        title: 'Проекты',
        from: q.from,
        to: q.to,
        extra: [`Проекты: ${STATUS_LABEL[q.status].toLowerCase()}`, `Режим: ${MODE_LABEL[q.mode].toLowerCase()}`],
        filters: filterText(filterNames(companyId, reportFilter(q))),
        stock: data.meta.stock,
        noBatch: data.meta.noBatch,
      });
      const sheet = projectsSheet({ rows: data.rows, total: data.total, currency: data.meta.currency, info });
      return { fileName: exportFileName(company.name, 'Проекты', now(), timezone), data: buildXlsx(sheet, { strings: 'shared' }) };
    },

    operations(companyId, q) {
      requireCompany(db, companyId);
      const projects = q.report === 'projects';
      const indicators = q.report === 'indicators';
      // у «Проектов» фильтра по проектам нет (проекты и есть строки): параметры проектов в запросе не читаются;
      // у «Финансовых показателей» фильтра нет совсем (§8.1)
      const f: ReportFilter = indicators ? {} : projects ? { ...reportFilter(q), projectIds: [], withoutProject: false } : reportFilter(q);
      companyAccounts(companyId, f);
      // у «Проектов» колонок шага нет — ячейка за весь период
      const range = projects ? { from: q.from, to: q.to } : drillRange(reportColumns(q.from, q.to, q.step), q.col);
      if (!range) throw invalid('col', 'Неизвестная колонка');
      // «Проекты» — по правилам «Прибыли» (§7): дата сделки, исключения, склад
      const pnl = q.report !== 'cashflow';
      const bounds: LineRange = {
        start: startOfDayUtc(range.from, timezone),
        end: startOfDayUtc(addDays(range.to, 1), timezone),
        ...(pnl ? { accrual: range } : {}),
      };
      const indicator = indicators ? indicatorCellWhere(companyId, q.row as IndicatorKey) : null;
      const where = projects
        ? projectsCellWhere(companyId, f, bounds, q.row, q.col as ProjectsCol)
        : indicator
          ? [reportLineWhere(companyId, f, bounds), indicator.where]
          : [reportLineWhere(companyId, f, bounds, parseDrillRow(q.row)!)];
      // у показателя склад — флажок его части расходов (§8.2); «Процент маржи» — как «Прибыль»
      const stock = pnl && stockOn(companyId, indicator ? { stock: indicator.stock } : q);
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
        const paid = stock ? paidOperations(companyId, found.map((r) => r.id)) : new Map<number, PaidOperation>();
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

    exportXlsx(companyId, report, q) {
      const company = requireCompany(db, companyId);
      const data = service[report](companyId, q);
      // сведения над таблицей (R13): период, шаг, разрез, фильтры по названиям, у «Прибыли» — склад и «Нет партии»
      const info = reportInfo({
        title: REPORT_TITLE[report],
        from: q.from,
        to: q.to,
        step: q.step,
        by: q.by,
        filters: filterText(filterNames(companyId, reportFilter(q))),
        ...(report === 'pnl' ? { stock: data.meta.stock === true, noBatch: data.meta.noBatch ?? 0 } : {}),
      });
      const sheet = reportSheet({ name: REPORT_TITLE[report], columns: data.columns, rows: data.rows, currency: data.meta.currency, percent: q.pct === true, info });
      return { fileName: exportFileName(company.name, REPORT_TITLE[report], now(), timezone), data: buildXlsx(sheet, { strings: 'shared' }) };
    },

    indicators(companyId, q) {
      const company = requireCompany(db, companyId);
      const columns = reportColumns(q.from, q.to, q.step);
      const starts = columnStarts(columns, timezone);
      // те же границы и строки, что у «Прибыли» (§8.1): дата сделки, исключения; склад — если у компании он есть
      const range = dealRange(q);
      const stock = stockOn(companyId, { stock: true });
      const store = stock ? stockInput(companyId, range.start, range.end) : null;
      const parts = partViews(companyId);
      const result = indicatorRows({ starts, lines: selectDealLines(companyId, {}, range, stock), categories: dicts(companyId).categories, parts, stock: store ? store.costs : null });
      return {
        columns,
        rows: result.rows,
        parts,
        meta: { from: q.from, to: q.to, step: q.step, currency: company.baseCurrency, empty: result.empty, stock, noBatch: store ? store.noBatch.length : 0 },
      };
    },

    indicatorsXlsx(companyId, q) {
      const company = requireCompany(db, companyId);
      const data = service.indicators(companyId, q);
      const names = new Map(dicts(companyId).categories.map((c) => [c.id, c.name]));
      const info = reportInfo({
        title: 'Финансовые показатели',
        from: q.from,
        to: q.to,
        step: q.step,
        extra: INDICATOR_PARTS.map((p) => `${PART_LABEL[p]}: ${partDiff(p, data.parts[p], names).text}`),
        filters: 'нет',
        noBatch: data.meta.noBatch,
      });
      const sheet = indicatorsSheet({ columns: data.columns, rows: data.rows, currency: data.meta.currency, info });
      return { fileName: exportFileName(company.name, 'Финансовые показатели', now(), timezone), data: buildXlsx(sheet, { strings: 'shared' }) };
    },

    savePart(companyId, part, input, userId) {
      requireCompany(db, companyId, { writable: true });
      const kind = PART_KIND[part];
      const all = dicts(companyId).categories;
      const own = new Set(all.filter((c) => c.kind === kind).map((c) => c.id));
      const ids = input.allCategories ? [] : [...new Set(input.categoryIds)];
      if (ids.some((id) => !own.has(id))) throw invalid('categoryIds', kind === 'income' ? 'Неизвестная категория дохода' : 'Неизвестная категория расхода');
      // у «Выручки» склада нет: флажок — только у частей расходов
      const next: IndicatorPartView = { allCategories: input.allCategories, categoryIds: ids, includeStock: kind === 'expense' && input.includeStock, isDefault: false };
      const before = partViews(companyId)[part];
      const same =
        !before.isDefault &&
        before.allCategories === next.allCategories &&
        before.includeStock === next.includeStock &&
        JSON.stringify(before.categoryIds) === JSON.stringify(next.categoryIds);
      if (same) return partViews(companyId);
      const names = new Map(all.map((c) => [c.id, c.name]));
      mutate(db, audit, (tx, record) => {
        const row = { allCategories: next.allCategories, categoryIds: JSON.stringify(next.categoryIds), includeStock: next.includeStock, updatedAt: now().toISOString(), updatedBy: userId };
        tx.insert(analyticsIndicatorParts)
          .values({ companyId, part, ...row })
          .onConflictDoUpdate({ target: [analyticsIndicatorParts.companyId, analyticsIndicatorParts.part], set: row })
          .run();
        record({ companyId, userId, entity: 'indicator_part', action: 'update', diff: { part, before: partDiff(part, before, names), after: partDiff(part, next, names) } });
      });
      return partViews(companyId);
    },

    resetPart(companyId, part, userId) {
      requireCompany(db, companyId, { writable: true });
      const before = partViews(companyId)[part];
      if (before.isDefault) return partViews(companyId);
      const names = new Map(dicts(companyId).categories.map((c) => [c.id, c.name]));
      mutate(db, audit, (tx, record) => {
        tx.delete(analyticsIndicatorParts)
          .where(and(eq(analyticsIndicatorParts.companyId, companyId), eq(analyticsIndicatorParts.part, part)))
          .run();
        record({ companyId, userId, entity: 'indicator_part', action: 'reset', diff: { part, before: partDiff(part, before, names), after: partDiff(part, partViews(companyId)[part], names) } });
      });
      return partViews(companyId);
    },

    statement(companyId, q) {
      requireCompany(db, companyId);
      const account = statementAccount(companyId, q.account);
      return { account, summary: statementTotals(companyId, account, q), ...statementPage(companyId, account.id, q), meta: { from: q.from, to: q.to } };
    },

    statementOperations(companyId, q) {
      requireCompany(db, companyId);
      return statementPage(companyId, statementAccount(companyId, q.account).id, q);
    },

    statementXlsx(companyId, q) {
      const company = requireCompany(db, companyId);
      const account = statementAccount(companyId, q.account);
      // предел выгрузки (R1): тот же, что у журнала, — проверяем до сборки файла
      const count = db.get<{ n: number }>(sql`SELECT COUNT(*) AS n FROM operations o WHERE ${statementWhere(companyId, account.id, q)}`)!.n;
      if (count > exportLimit) throw new AppError(422, 'EXPORT_LIMIT', `Больше ${exportLimit.toLocaleString('ru-RU')} операций — сузьте период или фильтр`);
      const summary = statementTotals(companyId, account, q);
      const sheet = statementSheet({ account, from: q.from, to: q.to, summary, rows: statementRows(companyId, account.id, q, summary.start), timeZone: timezone });
      return { fileName: exportFileName(company.name, 'Выписка по счету', now(), timezone), data: buildXlsx(sheet, { strings: 'shared' }) };
    },
  };
  return service;
}
