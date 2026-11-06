import { z } from 'zod';
import { TILES_MAX } from '../analytics-catalog';
import { checkPeriod, checkRange, reportDate } from './analytics';
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

/** `GET …/club-analytics/overview` (§4): шага и разреза у «Обзора» нет; ряд по дням — на весь период (до 5 лет). */
export const overviewQuerySchema = z.object({ from: clubShape.from, to: clubShape.to, project: clubShape.project, compare: clubShape.compare }).superRefine((v, ctx) => {
  checkRange(v, ctx);
});

/** Строки ячейки (§2.2): строка отчёта и колонка (дата начала колонки или `total`), курсор страницы. */
export const revenueRowsQuerySchema = z
  .object({
    ...clubShape,
    row: z.enum(['packages', 'rent', 'hours', 'bar', 'revenue', 'refills', 'desk'], { message: 'Неизвестная строка' }),
    col: z.string().regex(/^(\d{4}-\d{2}-\d{2}|total)$/, 'Неизвестная колонка'),
    cursor: z.preprocess(blank, z.coerce.number().int().min(0).default(0)),
  })
  .superRefine(checkPeriod);

/** `GET …/club-analytics/load` (§6): разрез графика — все зоны или по зонам. */
export const loadQuerySchema = z
  .object({ ...clubShape, by: z.preprocess(blank, z.enum(['all', 'zones'], { message: 'Разрез — all или zones' }).default('all')) })
  .superRefine(checkPeriod);

/** Сеансы ячейки карты «Загрузки» (R15): день недели 0 = Пн, час 0–23. */
export const loadRowsQuerySchema = z
  .object({
    ...clubShape,
    weekday: z.coerce.number({ message: 'День недели 0–6' }).int().min(0).max(6),
    hour: z.coerce.number({ message: 'Час 0–23' }).int().min(0).max(23),
    cursor: z.preprocess(blank, z.coerce.number().int().min(0).default(0)),
  })
  .superRefine(checkPeriod);

export type RevenueQuery = z.output<typeof revenueQuerySchema>;
export type LoadQuery = z.output<typeof loadQuerySchema>;
export type LoadRowsQuery = z.output<typeof loadRowsQuerySchema>;
export type RevenueRowsQuery = z.output<typeof revenueRowsQuerySchema>;
export type OverviewQuery = z.output<typeof overviewQuerySchema>;

/** `PUT …/senet/offices/:id/zones` (§6.1): своё число ПК зоны; null — по данным Senet. */
export const zonesInputSchema = z.object({
  zones: z
    .array(
      z.object({
        zone: z.string().trim().min(1, 'Укажите зону').max(100, 'Не длиннее 100 знаков'),
        seats: z.number({ message: 'От 1 до 1000' }).int('От 1 до 1000').min(1, 'От 1 до 1000').max(1000, 'От 1 до 1000').nullable(),
      }),
    )
    .max(50, 'Не больше 50 зон'),
});
export type ZonesInput = z.output<typeof zonesInputSchema>;

/** Ссылка на гостя или ключ (спецификация «Аналитика клуба», R25): 16 hex. */
const guestRef = z.string().regex(/^[0-9a-f]{16}$/, 'Гость не найден');

/** `POST …/club-analytics/guests/links` (§7.1, R18): `merge` — гости `a` и `b`; `split` — ключ `a` из гостя `b`. */
export const guestLinkInputSchema = z.object({ kind: z.enum(['merge', 'split']), a: guestRef, b: guestRef });
export type GuestLinkInput = z.output<typeof guestLinkInputSchema>;

/** `GET …/club-analytics/guests` (§7): период, шаг, клуб, сравнение; разреза нет. */
export const guestsQuerySchema = z.object(clubShape).superRefine(checkPeriod);
export type GuestsQuery = z.output<typeof guestsQuerySchema>;
