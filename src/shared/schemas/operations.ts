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
const ISO_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?(?:Z|[+-]\d{2}:\d{2})$/;
const paidAt = z
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
