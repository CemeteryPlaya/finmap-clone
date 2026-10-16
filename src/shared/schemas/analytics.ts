import { z } from 'zod';
import { isValidDate } from '../dates';
import { columnCount, maxReportTo, parseDrillRow, REPORT_MAX_COLUMNS, type ReportFilter } from '../report-engine';
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
};

function checkPeriod(v: { from: string; to: string; step: 'day' | 'week' | 'month' | 'quarter' }, ctx: z.RefinementCtx): void {
  if (v.to < v.from) ctx.addIssue({ code: 'custom', path: ['to'], message: 'Конец периода раньше начала' });
  else if (v.to > maxReportTo(v.from)) ctx.addIssue({ code: 'custom', path: ['to'], message: PERIOD_TOO_LONG });
  else if (columnCount(v.from, v.to, v.step) > REPORT_MAX_COLUMNS) ctx.addIssue({ code: 'custom', path: ['step'], message: TOO_MANY_COLUMNS });
}

/** `GET …/analytics/cashflow` (§9). */
export const reportQuerySchema = z.object(reportShape).superRefine(checkPeriod);

/**
 * `GET …/analytics/operations` (§2.5, §9): операции ячейки отчёта — строка (`row`, id строки ответа), колонка (`col`,
 * ключ колонки или `total`), те же параметры отчёта, курсор и размер страницы.
 */
export const cellQuerySchema = z
  .object({
    ...reportShape,
    report: z.enum(['cashflow'], { message: 'Неизвестный отчёт' }),
    row: z.string({ message: 'Укажите строку отчёта' }).refine((v) => parseDrillRow(v) !== null, 'Строка отчёта не раскрывается в операции'),
    col: z.string({ message: 'Укажите колонку отчёта' }).max(20, 'Неизвестная колонка'),
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
  })
  .superRefine(checkPeriod);

export type ReportQuery = z.output<typeof reportQuerySchema>;
export type CellQuery = z.output<typeof cellQuerySchema>;

/** Параметры запроса → фильтр движка отчётов. */
export function reportFilter(q: ReportQuery | CellQuery): ReportFilter {
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
