import { z } from 'zod';
import { TILES_MAX } from '../analytics-catalog';
import { checkPeriod, reportDate } from './analytics';
import { queryParts } from './journal';

/** Ключ группы, карточки или плитки каталога: латиница, цифры, дефис, точка. */
const catalogKey = z.string().regex(/^[a-z][a-zA-Z0-9.-]{0,63}$/, 'Неизвестный ключ');
const item = z.object({ key: catalogKey, visible: z.boolean({ message: 'Да или нет' }) });

/** `PUT …/analytics-settings/dashboards` (спецификация «Аналитика клуба», §10.1). */
export const savedDashboardsSchema = z.object({
  groups: z.array(z.object({ key: catalogKey, visible: z.boolean({ message: 'Да или нет' }), cards: z.array(item).max(50) })).max(20),
});

/** `PUT …/analytics-settings/tiles.<шаблон>` (§10.2): видимых не больше 12. */
export const savedTilesSchema = z.object({
  items: z
    .array(item)
    .max(50)
    .refine((items) => items.filter((i) => i.visible).length <= TILES_MAX, `Не больше ${TILES_MAX} плиток`),
});

const { blank, id } = queryParts;

/** Разрезы «Выручки клуба» (§5.2). */
export const REVENUE_BYS = ['parts', 'payment', 'shifts', 'cashiers'] as const;
export type RevenueBy = (typeof REVENUE_BYS)[number];

/** Общие параметры отчётов клуба (§11): период, шаг, клуб, сравнение. */
const clubShape = {
  from: reportDate,
  to: reportDate,
  step: z.preprocess(blank, z.enum(['day', 'week', 'month', 'quarter'], { message: 'Шаг — day, week, month или quarter' }).default('month')),
  project: z.preprocess(blank, id.optional()),
  /** Сравнение с прошлым периодом (§2.2): `1` — по умолчанию, `0` — выключено. */
  compare: z.preprocess(blank, z.enum(['0', '1'], { message: 'Сравнение — 0 или 1' }).default('1')).transform((v) => v === '1'),
};

/** `GET …/club-analytics/revenue` (§5, §11). */
export const revenueQuerySchema = z
  .object({
    ...clubShape,
    by: z.preprocess(blank, z.enum(REVENUE_BYS, { message: 'Разрез — parts, payment, shifts или cashiers' }).default('parts')),
    view: z.preprocess(blank, z.enum(['table', 'hours'], { message: 'Вид — table или hours' }).default('table')),
  })
  .superRefine(checkPeriod);

/** Строки ячейки (§2.2): строка отчёта и колонка (дата начала колонки или `total`), курсор страницы. */
export const revenueRowsQuerySchema = z
  .object({
    ...clubShape,
    row: z.enum(['packages', 'rent', 'hours', 'bar', 'revenue', 'refills', 'desk'], { message: 'Неизвестная строка' }),
    col: z.string().regex(/^(\d{4}-\d{2}-\d{2}|total)$/, 'Неизвестная колонка'),
    cursor: z.preprocess(blank, z.coerce.number().int().min(0).default(0)),
  })
  .superRefine(checkPeriod);

export type RevenueQuery = z.output<typeof revenueQuerySchema>;
export type RevenueRowsQuery = z.output<typeof revenueRowsQuerySchema>;
