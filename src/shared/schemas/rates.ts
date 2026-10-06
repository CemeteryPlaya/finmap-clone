import { z } from 'zod';
import { isKnownCurrency } from '../currencies';
import { isValidDate } from '../dates';
import { parseDecimal } from '../decimal';

const rate = z
  .string()
  .trim()
  .refine((s) => {
    const d = parseDecimal(s);
    return d !== null && d > 0n;
  }, 'Курс — положительное число, не больше 10 знаков после запятой');
const date = z.string().refine(isValidDate, 'Неверная дата');
const currency = z.string().refine(isKnownCurrency, 'Неизвестная валюта');

export const manualRateCreateSchema = z.object({ date, currency, rate });
export const manualRateUpdateSchema = z.object({ rate });

export const fixedRateCreateSchema = z.object({
  currency,
  rate,
  validFrom: date,
  validTo: date.nullable().default(null),
});
export const fixedRateUpdateSchema = z.object({
  rate: rate.optional(),
  validFrom: date.optional(),
  validTo: date.nullable().optional(),
});

export const rateQuerySchema = z.object({ date, currency });
