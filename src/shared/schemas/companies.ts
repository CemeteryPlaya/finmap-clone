import { z } from 'zod';
import { isKnownCurrency } from '../currencies';
import { nameField } from '../text';

const name = nameField(100);
const baseCurrency = z.string().refine(isKnownCurrency, 'Неизвестная валюта');

export const companyCreateSchema = z.object({ name, baseCurrency: baseCurrency.default('KZT') });
export const companyUpdateSchema = z.object({ name: name.optional(), baseCurrency: baseCurrency.optional() });
