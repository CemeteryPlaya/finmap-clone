import { z } from 'zod';
import { isKnownCurrency } from '../currencies';
import { isValidDate } from '../dates';
import { nameField } from '../text';

/** Название счёта шаблона = префикс + название проекта (до 100), поэтому лимит с запасом. */
export const ACCOUNT_NAME_MAX = 120;

const name = nameField(ACCOUNT_NAME_MAX);
const currency = z.string().refine(isKnownCurrency, 'Неизвестная валюта');
// zod 4 .int() сам отклоняет числа вне безопасного диапазона — поэтому две отдельные проверки
const startingBalance = z
  .number()
  .refine(Number.isInteger, 'Сумма в минимальных единицах — целое число')
  .refine(Number.isSafeInteger, 'Слишком большая сумма');
const openedAt = z.string().refine(isValidDate, 'Неверная дата');
const projectId = z.number().int().positive().nullable();

export const accountCreateSchema = z.object({
  name,
  currency,
  startingBalance: startingBalance.default(0),
  openedAt: openedAt.optional(),
  projectId: projectId.default(null),
});

export const accountUpdateSchema = z.object({
  name: name.optional(),
  currency: currency.optional(),
  startingBalance: startingBalance.optional(),
  openedAt: openedAt.optional(),
  projectId: projectId.optional(),
});
