import { z } from 'zod';
import { isValidDate } from '../dates';

export const JOURNAL_LIMIT_DEFAULT = 50;
export const JOURNAL_LIMIT_MAX = 200;
/** Не больше значений в одном списке фильтра (счета, статьи…). */
export const JOURNAL_LIST_MAX = 200;

/** Пустая строка в запросе (`amountMin=`) — то же, что отсутствие параметра. */
const blank = (v: unknown) => (v === '' ? undefined : v);

/**
 * Список значений. Fastify 5 отдаёт повторённый ключ строки запроса массивом (`types=income&types=transfer`),
 * а одиночный — строкой (`types=income`); в JSON сохранённого фильтра — массив. Пустые значения отбрасываются,
 * повторы убираются, порядок — по возрастанию; пустой список — то же, что его отсутствие.
 */
function list<T extends string | number>(item: z.ZodType<T>) {
  return z.preprocess(
    (v) => {
      if (v === undefined) return undefined;
      const xs = (Array.isArray(v) ? v : [v]).filter((x) => x !== '');
      return xs.length ? xs : undefined;
    },
    z
      .array(item)
      .max(JOURNAL_LIST_MAX, `Не больше ${JOURNAL_LIST_MAX} значений`)
      .transform((xs) => [...new Set(xs)].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0)))
      .optional(),
  );
}

const id = z.coerce.number({ message: 'Неверный идентификатор' }).int('Неверный идентификатор').positive('Неверный идентификатор');
/** Флаг: true, 'true' или '1' — включён; false, 'false', '0' или пусто — не задан. */
const flag = z.preprocess(
  (v) => (v === true || v === 'true' || v === '1' ? true : v === false || v === 'false' || v === '0' || v === '' ? undefined : v),
  z.literal(true, { message: 'Ожидается true или false' }).optional(),
);
const date = z.preprocess(blank, z.string().refine(isValidDate, 'Неверная дата').optional());
/** Сумма в минимальных единицах базовой валюты компании (сравнивается с baseAmount). */
const amount = z.preprocess(
  blank,
  z.coerce
    .number({ message: 'Неверная сумма' })
    .int('Сумма — целое число минимальных единиц')
    .min(0, 'Сумма не меньше нуля')
    .max(Number.MAX_SAFE_INTEGER, 'Слишком большая сумма')
    .optional(),
);

/** Поля фильтра журнала (§6 «Фильтр журнала»); общие у списка, выгрузки и сохранённого фильтра. */
const filterShape = {
  from: date,
  to: date,
  q: z.preprocess(
    blank,
    z
      .string()
      .trim()
      .max(200, 'Не длиннее 200 символов')
      .transform((v) => v || undefined)
      .optional(),
  ),
  amountMin: amount,
  amountMax: amount,
  types: list(z.enum(['income', 'expense', 'transfer'], { message: 'Неверный тип операции' })),
  accountIds: list(id),
  counterpartyIds: list(id),
  tagIds: list(id),
  categoryIds: list(id),
  projectIds: list(id),
  withoutCategory: flag,
  withoutProject: flag,
  withoutCounterparty: flag,
};

const sortShape = {
  sort: z.preprocess(blank, z.enum(['date', 'amount'], { message: 'Сортировка — date или amount' }).default('date')),
  order: z.preprocess(blank, z.enum(['asc', 'desc'], { message: 'Порядок — asc или desc' }).default('desc')),
};

function checkRanges(f: { from?: string; to?: string; amountMin?: number; amountMax?: number }, ctx: z.RefinementCtx): void {
  if (f.from && f.to && f.from > f.to) ctx.addIssue({ code: 'custom', path: ['to'], message: 'Конец периода раньше начала' });
  if (f.amountMin !== undefined && f.amountMax !== undefined && f.amountMin > f.amountMax) {
    ctx.addIssue({ code: 'custom', path: ['amountMax'], message: '«До» меньше, чем «от»' });
  }
}

/** Фильтр журнала — и для сохранённых фильтров (их JSON проверяется этой же схемой). Лишние поля отбрасываются. */
export const journalFilterSchema = z.object(filterShape).superRefine(checkRanges);

/** Строка запроса списка `GET /companies/:cid/operations`: фильтр, сортировка, курсор и размер страницы. */
export const journalQuerySchema = z
  .object({
    ...filterShape,
    ...sortShape,
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
  .superRefine(checkRanges);

/** Строка запроса выгрузки `GET …/operations/export.xlsx`: фильтр и сортировка, без страниц. */
export const journalExportSchema = z.object({ ...filterShape, ...sortShape }).superRefine(checkRanges);

export type JournalFilter = z.output<typeof journalFilterSchema>;
export type JournalQuery = z.output<typeof journalQuerySchema>;
export type JournalExportQuery = z.output<typeof journalExportSchema>;
export type JournalSort = JournalQuery['sort'];
export type JournalOrder = JournalQuery['order'];
