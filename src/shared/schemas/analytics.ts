import { z } from 'zod';
import { isValidDate } from '../dates';
import { columnCount, maxReportTo, parseDrillRow, REPORT_MAX_COLUMNS, type ReportFilter } from '../report-engine';
import { parseProjectsRow, PROJECTS_COLS, type ProjectsCol } from '../report-projects';
import { JOURNAL_LIMIT_DEFAULT, JOURNAL_LIMIT_MAX, queryParts } from './journal';

const { blank, list, id, flag } = queryParts;

/** Дата периода отчёта — обязательна; год не выше 9998, как у журнала. */
const reportDate = z.string({ message: 'Укажите дату' }).refine((v) => isValidDate(v) && v < '9999', 'Неверная дата');

/** Текст ошибки шага, который даёт больше 92 колонок (§2.3, §9). */
export const TOO_MANY_COLUMNS = 'Слишком много колонок — выберите больший шаг';
export const PERIOD_TOO_LONG = 'Период больше 5 лет';

/**
 * Общие параметры отчётов (§9 спецификации «Аналитика»): период, шаг, разрез и фильтры. Списки — повтором ключа,
 * как у фильтров журнала (`categories=1&categories=2`); флаги «без …» — `true`.
 */
const reportShape = {
  from: reportDate,
  to: reportDate,
  step: z.preprocess(blank, z.enum(['day', 'week', 'month', 'quarter'], { message: 'Шаг — day, week, month или quarter' }).default('month')),
  by: z.preprocess(blank, z.enum(['category', 'counterparty', 'project'], { message: 'Разрез — category, counterparty или project' }).default('category')),
  accounts: list(id),
  categories: list(id),
  counterparties: list(id),
  projects: list(id),
  tags: list(id),
  withoutCategory: flag,
  withoutCounterparty: flag,
  withoutProject: flag,
  /** «Учитывать склад по себестоимости» (§5.3): `1` — включён (по умолчанию), `0` — выключен. «Деньги» его не читают. */
  stock: z.preprocess(blank, z.enum(['0', '1'], { message: 'Склад — 0 или 1' }).default('1')).transform((v) => v === '1'),
};

/** Период (§2.3): «по» не раньше «с», не больше 5 лет. true — период верный и годится для расчёта. */
function checkRange(v: { from: string; to: string }, ctx: z.RefinementCtx): boolean {
  // неверная дата уже названа ошибкой поля — период не считаем (иначе addDays падает на RangeError)
  if (![v.from, v.to].every((x) => isValidDate(x) && x < '9999')) return false;
  if (v.to < v.from) ctx.addIssue({ code: 'custom', path: ['to'], message: 'Конец периода раньше начала' });
  else if (v.to > maxReportTo(v.from)) ctx.addIssue({ code: 'custom', path: ['to'], message: PERIOD_TOO_LONG });
  else return true;
  return false;
}

function checkPeriod(v: { from: string; to: string; step: 'day' | 'week' | 'month' | 'quarter' }, ctx: z.RefinementCtx): void {
  if (checkRange(v, ctx) && columnCount(v.from, v.to, v.step) > REPORT_MAX_COLUMNS) ctx.addIssue({ code: 'custom', path: ['step'], message: TOO_MANY_COLUMNS });
}

/** Курсор и размер страницы списков операций (§2.5, §6): как у журнала. */
const pageShape = {
  cursor: z.preprocess(blank, z.string().max(500, 'Неверный курсор').optional()),
  limit: z.preprocess(
    blank,
    z.coerce
      .number({ message: 'От 1 до 200' })
      .int('От 1 до 200')
      .min(1, 'От 1 до 200')
      .max(JOURNAL_LIMIT_MAX, 'От 1 до 200')
      .default(JOURNAL_LIMIT_DEFAULT),
  ),
};

/** `GET …/analytics/cashflow` и `…/pnl` (§9). */
export const reportQuerySchema = z.object(reportShape).superRefine(checkPeriod);

/** `GET …/analytics/{cashflow|pnl}.xlsx` (§2.6): параметры отчёта и проценты, как на экране (`pct=true`). */
export const reportExportSchema = z.object({ ...reportShape, pct: flag }).superRefine(checkPeriod);

/** Отчёты по колонкам шага с одной выгрузкой (А-2): «Деньги» и «Прибыль». */
export const REPORT_KINDS = ['cashflow', 'pnl'] as const;
export type ReportKind = (typeof REPORT_KINDS)[number];

/** Отчёты, у которых есть операции ячейки (§2.5): «Деньги», «Прибыль» и «Проекты». */
export const CELL_REPORTS = ['cashflow', 'pnl', 'projects'] as const;

/**
 * «Проекты» (§7, §9): период по дате сделки, статус проектов (`active` по умолчанию, `archived`, `all`), режим
 * (`projects` — только проекты, `categories` — с категориями), склад, фильтр без проектов — проекты и есть строки отчёта.
 */
const projectsShape = {
  from: reportDate,
  to: reportDate,
  status: z.preprocess(blank, z.enum(['active', 'archived', 'all'], { message: 'Статус — active, archived или all' }).default('active')),
  mode: z.preprocess(blank, z.enum(['projects', 'categories'], { message: 'Режим — projects или categories' }).default('projects')),
  accounts: reportShape.accounts,
  categories: reportShape.categories,
  counterparties: reportShape.counterparties,
  tags: reportShape.tags,
  withoutCategory: reportShape.withoutCategory,
  withoutCounterparty: reportShape.withoutCounterparty,
  stock: reportShape.stock,
};

/** `GET …/analytics/projects` и `…/projects.xlsx` (§7, §9). */
export const projectsQuerySchema = z.object(projectsShape).superRefine((v, ctx) => void checkRange(v, ctx));

const NOT_DRILLABLE = 'Строка отчёта не раскрывается в операции';

/**
 * `GET …/analytics/operations` (§2.5, §9): операции ячейки отчёта — строка (`row`, id строки ответа), колонка (`col`,
 * ключ колонки или `total`), те же параметры отчёта, курсор и размер страницы. «Чистый денежный поток» есть только у
 * «Денег», «Прибыль» — только у «Прибыли». У «Проектов» (§7) строки — свои (parseProjectsRow), колонка — `income`,
 * `expense` или `total` (прибыль и проценты — все операции строки), период — весь, без шага.
 */
export const cellQuerySchema = z
  .object({
    ...reportShape,
    report: z.enum(CELL_REPORTS, { message: 'Неизвестный отчёт' }),
    row: z.string({ message: 'Укажите строку отчёта' }).max(80, NOT_DRILLABLE),
    col: z.string({ message: 'Укажите колонку отчёта' }).max(20, 'Неизвестная колонка'),
    ...pageShape,
  })
  // у «Проектов» колонок нет (период — весь, без шага): число колонок не считаем
  .superRefine((v, ctx) => (v.report === 'projects' ? void checkRange(v, ctx) : checkPeriod(v, ctx)))
  .superRefine((v, ctx) => {
    const drill = v.report === 'projects' ? parseProjectsRow(v.row) : parseDrillRow(v.row);
    if (drill === null || (v.report === 'cashflow' && v.row === 'profit') || (v.report === 'pnl' && v.row === 'net')) ctx.addIssue({ code: 'custom', path: ['row'], message: NOT_DRILLABLE });
    if (v.report === 'projects' && !PROJECTS_COLS.includes(v.col as ProjectsCol)) ctx.addIssue({ code: 'custom', path: ['col'], message: 'Неизвестная колонка' });
  });

/** Счёт выписки (§6): обязателен, одно значение. */
const statementAccount = z.preprocess(blank, z.string({ error: (issue) => (Array.isArray(issue.input) ? 'Укажите один счёт' : 'Укажите счёт') }).regex(/^[1-9]\d{0,14}$/, 'Неизвестный счёт').transform(Number));

/** `GET …/analytics/statement` и `…/statement/operations` (§6, §9): счёт, период, курсор и размер страницы. */
export const statementQuerySchema = z.object({ account: statementAccount, from: reportDate, to: reportDate, ...pageShape }).superRefine((v, ctx) => void checkRange(v, ctx));

/** `GET …/analytics/statement.xlsx` (§2.6, §6): счёт и период. */
export const statementExportSchema = z.object({ account: statementAccount, from: reportDate, to: reportDate }).superRefine((v, ctx) => void checkRange(v, ctx));

export type ReportQuery = z.output<typeof reportQuerySchema>;
export type ProjectsQuery = z.output<typeof projectsQuerySchema>;
export type StatementQuery = z.output<typeof statementQuerySchema>;
export type StatementExportQuery = z.output<typeof statementExportSchema>;
export type CellQuery = z.output<typeof cellQuerySchema>;
export type ReportExportQuery = z.output<typeof reportExportSchema>;

/** Параметры фильтра в запросе отчёта (у «Проектов» — без проектов). */
type FilterQuery = Partial<Pick<ReportQuery, 'accounts' | 'categories' | 'counterparties' | 'projects' | 'tags' | 'withoutCategory' | 'withoutCounterparty' | 'withoutProject'>>;

/** Параметры запроса → фильтр движка отчётов. */
export function reportFilter(q: FilterQuery): ReportFilter {
  return {
    accountIds: q.accounts ?? [],
    categoryIds: q.categories ?? [],
    counterpartyIds: q.counterparties ?? [],
    projectIds: q.projects ?? [],
    tagIds: q.tags ?? [],
    withoutCategory: q.withoutCategory === true,
    withoutCounterparty: q.withoutCounterparty === true,
    withoutProject: q.withoutProject === true,
  };
}
