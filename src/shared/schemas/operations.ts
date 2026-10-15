import { z } from 'zod';
import { isValidDate } from '../dates';

const id = z.number().int().positive();
// zod 4 .int() сам отклоняет числа вне безопасного диапазона — поэтому отдельные проверки
const money = z
  .number()
  .refine(Number.isInteger, 'Сумма — целое число минимальных единиц')
  .refine((v) => v > 0, 'Сумма больше нуля')
  .refine(Number.isSafeInteger, 'Слишком большая сумма');
/** ISO-дата и время с часовым поясом: без пояса момент зависел бы от часов сервера. */
const ISO_RE = /^\d{4}-\d{2}-\d{2}T([01]\d|2[0-3]):[0-5]\d(?::[0-5]\d(?:\.\d{1,3})?)?(?:Z|[+-]\d{2}:\d{2})$/;
export const paidAt = z
  .string()
  .refine((s) => ISO_RE.test(s) && isValidDate(s.slice(0, 10)) && !Number.isNaN(Date.parse(s)), 'Неверные дата и время оплаты');
const accrualDate = z.string().refine(isValidDate, 'Неверная дата').nullable();
const comment = z
  .string()
  .trim()
  .max(2000, 'Не длиннее 2000 символов')
  .nullable()
  .transform((v) => v || null);
const line = z.object({
  categoryId: id.nullable().default(null),
  projectId: id.nullable().default(null),
  amount: money,
});
const lines = z.array(line).max(50, 'Не больше 50 строк');
const tagIds = z.array(id).max(20, 'Не больше 20 тегов');

export const operationCreateSchema = z.object({
  type: z.enum(['income', 'expense', 'transfer'], { message: 'Неверный тип операции' }),
  paidAt,
  accrualDate: accrualDate.default(null),
  accountId: id,
  amount: money,
  toAccountId: id.nullable().default(null),
  toAmount: money.nullable().default(null),
  counterpartyId: id.nullable().default(null),
  comment: comment.optional(),
  lines: lines.default([]),
  tagIds: tagIds.default([]),
});

export const operationUpdateSchema = z.object({
  /** Версия, которую видел клиент (оптимистичная блокировка). */
  version: z.number().int().min(1),
  /** «Изменить в перевод» (§10.1 этапа 1.5): тип меняется только на перевод; у перевода `type: 'transfer'` ничего не меняет. */
  type: z.literal('transfer', { message: 'Тип можно сменить только на «Перевод»' }).optional(),
  paidAt: paidAt.optional(),
  accrualDate: accrualDate.optional(),
  accountId: id.optional(),
  amount: money.optional(),
  toAccountId: id.optional(),
  toAmount: money.optional(),
  counterpartyId: id.nullable().optional(),
  comment: comment.optional(),
  lines: lines.optional(),
  tagIds: tagIds.optional(),
});

/**
 * Не больше операций в одном массовом действии: запрос синхронный (better-sqlite3) и держит цикл событий —
 * 500 операций на демо-наборе обрабатываются за время, указанное в решениях плана 5a.
 */
export const BULK_MAX = 500;
const bulkIds = z.array(id).min(1, 'Выберите операции').max(BULK_MAX, `Не больше ${BULK_MAX} операций за раз`);

/** Массовые действия журнала (§7): без проверки версии, каждая изменённая операция получает новую версию и запись в истории. */
export const operationBulkSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('setCategory'), ids: bulkIds, categoryId: id }),
  z.object({ action: z.literal('setProject'), ids: bulkIds, projectId: id }),
  z.object({ action: z.literal('setCounterparty'), ids: bulkIds, counterpartyId: id }),
  z.object({ action: z.literal('delete'), ids: bulkIds }),
  z.object({ action: z.literal('restore'), ids: bulkIds }),
]);

export type OperationBulkInput = z.output<typeof operationBulkSchema>;

export interface BulkSkip {
  id: number;
  /** Причина по-русски — показывается в итоге «изменено N, пропущено M». */
  reason: string;
}

export interface BulkResult {
  /**
   * Операции, к которым действие применено. У «Категории», «Проекта», «Контрагента» — в том числе те, где значение
   * уже было таким. Удаление уже удалённой и восстановление неудалённой — пропуск: «Отменить» по changed
   * не вернёт операцию, которую удалили раньше и не этим действием.
   */
  changed: number[];
  skipped: BulkSkip[];
}
