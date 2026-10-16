import { allocate } from './money';
import { aggregate, bucketOf, type DictCategory, type LineType, type ReportBy, type ReportColumn, type ReportDicts, type ReportFilter, type ReportLine, type ReportRow } from './report-engine';
import { effectiveSystemKey, type SystemKey } from './system-categories';

/**
 * «Прибыль / P&L» (§5 спецификации «Аналитика»): чистые функции поверх движка отчётов. Строки операций приходят с датой
 * сделки (accrual_date, иначе день paid_at), переводов среди них нет. Здесь — исключённые системные категории, строки
 * склада (§5.3) и итоговая «Прибыль».
 */

/** Системные категории вне «Прибыли» (§5.1): инвестиции, дивиденды, займы и кредиты. Зарплата, налоги и НДС — обычные расходы. */
export const PNL_EXCLUDED_KEYS: readonly SystemKey[] = ['investment', 'dividends', 'loan_issued', 'loan_repaid', 'credit_received', 'credit_repayment'];

export const PNL_GROUP_LABEL: Record<LineType, string> = { income: 'Доходы', expense: 'Расходы' };

/** Категории, исключённые из «Прибыли»: системные по effectiveSystemKey — подкатегория системной исключена вместе с ней. */
export function pnlExcludedCategories(categories: readonly DictCategory[]): Set<number> {
  const byId = new Map(categories.map((c) => [c.id, c]));
  const out = new Set<number>();
  for (const c of categories) {
    const parent = c.parentId === null ? undefined : byId.get(c.parentId);
    const key = effectiveSystemKey(c.systemKey ?? null, parent?.systemKey ?? null);
    if (key !== null && PNL_EXCLUDED_KEYS.includes(key)) out.add(c.id);
  }
  return out;
}

/** Расход, оплативший поступления склада: сумма оплат и все строки операции (id и сумма в базовой валюте) по порядку. */
export interface PaidOperation {
  paid: number;
  lines: readonly { id: number; amount: number }[];
}

/**
 * Часть каждой строки расхода, оплатившая закупку (§5.3): сумма оплат (не больше суммы операции) делится по строкам
 * пропорционально их суммам — allocate, без потери тиына. Операция без положительной суммы или со строкой меньше нуля —
 * без исключения. Ответ — id строки → исключаемая сумма.
 */
export function paymentExclusions(ops: readonly PaidOperation[]): Map<number, number> {
  const out = new Map<number, number>();
  for (const op of ops) {
    const total = op.lines.reduce((s, l) => s + l.amount, 0);
    if (op.paid <= 0 || total <= 0 || op.lines.some((l) => l.amount < 0)) continue;
    const shares = allocate(Math.min(op.paid, total), op.lines.map((l) => l.amount));
    op.lines.forEach((l, i) => out.set(l.id, shares[i]!));
  }
  return out;
}

/**
 * Операция полностью оплачена закупкой (R1): исключаемый срез равен сумме её строк. Тот же расчёт, что в отчёте
 * (paymentExclusions), поэтому расход с отрицательной строкой или без положительной суммы оплаченным не считается, а
 * список операций ячейки «Прибыли» не расходится с итогом отчёта. lines — строки операции, попавшие в выборку.
 */
export function isFullyPaid(op: PaidOperation): boolean {
  const cut = [...paymentExclusions([op]).values()].reduce((s, v) => s + v, 0);
  return cut > 0 && cut === op.lines.reduce((s, l) => s + l.amount, 0);
}

export type StockCostKind = 'cogs' | 'writeoff';

/** Себестоимость строки «Продажи» или «Списания» склада (§5.3): момент документа, проект склада, сумма FIFO в базовой валюте. */
export interface StockCost {
  at: string;
  kind: StockCostKind;
  projectId: number;
  amount: number;
}

export interface StockInput {
  costs: readonly StockCost[];
  /** Продажи «Нет партии»: момент документа и проект склада, по одной на документ. */
  noBatch: readonly { at: string; projectId: number }[];
}

const has = (xs: readonly number[] | undefined): xs is number[] => !!xs && xs.length > 0;

/**
 * Строки склада при фильтре (§5.3): у документа склада нет категории, контрагента операции, тегов и счёта — фильтр по
 * ним склад убирает. Фильтр по проектам оставляет склады выбранных проектов; «Без проекта» склада не бывает.
 */
export function stockKept(f: ReportFilter, projectId: number): boolean {
  if (has(f.categoryIds) || has(f.counterpartyIds) || has(f.tagIds) || has(f.accountIds) || f.withoutCategory || f.withoutCounterparty) return false;
  return has(f.projectIds) ? f.projectIds.includes(projectId) : !f.withoutProject;
}

/** Названия строк склада: по категориям — как строки расходов, по контрагентам — с пометкой «склад» (§5.3). */
export const STOCK_ROW_LABEL: Record<'category' | 'counterparty', Record<StockCostKind, string>> = {
  category: { cogs: 'Себестоимость проданных товаров', writeoff: 'Списания товаров' },
  counterparty: { cogs: 'Себестоимость (склад)', writeoff: 'Списания (склад)' },
};

export interface PnlResult {
  rows: ReportRow[];
  /** Ни строк операций, ни себестоимости склада в периоде. */
  empty: boolean;
  /** Продаж «Нет партии» в периоде (с учётом фильтра) — для предупреждения под таблицей. */
  noBatch: number;
}

const total = (values: readonly number[]) => values.reduce((s, v) => s + v, 0);

/**
 * Строки «Прибыли» (§5.2): «Прибыль» = Доходы - Расходы, группы «Доходы» и «Расходы» со строками разреза. Исключённые
 * системные категории (§5.1) не видны даже нулями. stock — склад по себестоимости (§5.3), null — выключен:
 * - по категориям и контрагентам — строки «Себестоимость…» и «Списания…» в конце «Расходов»;
 * - по проектам — суммы склада входят в строку проекта склада.
 * Оплаты закупок исключает сервер до вызова (paymentExclusions): строки приходят с уменьшенными суммами.
 */
export function pnlRows(input: {
  columns: readonly ReportColumn[];
  starts: readonly string[];
  lines: readonly ReportLine[];
  by: ReportBy;
  dicts: ReportDicts;
  filter: ReportFilter;
  stock: StockInput | null;
}): PnlResult {
  const n = input.columns.length;
  const excluded = pnlExcludedCategories(input.dicts.categories);
  const dicts: ReportDicts = { ...input.dicts, categories: input.dicts.categories.filter((c) => !excluded.has(c.id)) };
  const lines = input.lines.filter((l) => l.categoryId === null || !excluded.has(l.categoryId));
  const inPeriod = (at: string) => bucketOf(input.starts, at) >= 0;
  const costs = (input.stock?.costs ?? []).filter((c) => stockKept(input.filter, c.projectId) && inPeriod(c.at));
  const stockLines: ReportLine[] = costs.map((c) => ({ at: c.at, type: 'expense', accountId: 0, categoryId: null, projectId: c.projectId, counterpartyId: null, amount: c.amount }));
  const byProject = input.by === 'project';
  const agg = aggregate({ lines: byProject ? [...lines, ...stockLines] : lines, starts: input.starts, by: input.by, dicts, filter: input.filter, labels: PNL_GROUP_LABEL });
  const empty = agg.empty && costs.length === 0;
  let expense = agg.expense.row;
  if (!byProject && input.stock && !empty) {
    const zeroAllowed = !has(input.filter.projectIds) && !input.filter.withoutProject && stockKept(input.filter, 0);
    const extra: ReportRow[] = [];
    let values = [...agg.expense.values];
    for (const kind of ['cogs', 'writeoff'] as const) {
      const own = costs.filter((c) => c.kind === kind);
      if (own.length === 0 && !zeroAllowed) continue;
      const v = new Array<number>(n).fill(0);
      for (const c of own) v[bucketOf(input.starts, c.at)]! += c.amount;
      values = values.map((x, i) => x + v[i]!);
      extra.push({ id: `expense:stock:${kind}`, kind: 'stock', label: STOCK_ROW_LABEL[input.by === 'counterparty' ? 'counterparty' : 'category'][kind], values: v, total: total(v) });
    }
    if (extra.length > 0) expense = { ...expense, values, total: total(values), children: [...(expense.children ?? []), ...extra] };
  }
  const income = agg.income.row;
  const profit = (income.values as number[]).map((v, i) => v - (expense.values[i] as number));
  const noBatch = input.stock ? input.stock.noBatch.filter((s) => stockKept(input.filter, s.projectId) && inPeriod(s.at)).length : 0;
  return { rows: [{ id: 'profit', kind: 'info', label: 'Прибыль', values: profit, total: total(profit) }, income, expense], empty, noBatch };
}
