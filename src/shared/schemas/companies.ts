import { z } from 'zod';
import { isKnownCurrency } from '../currencies';

const name = z.string().trim().min(1, 'Введите название').max(100, 'Не длиннее 100 символов');
const baseCurrency = z.string().refine(isKnownCurrency, 'Неизвестная валюта');

export const companyCreateSchema = z.object({ name, baseCurrency: baseCurrency.default('KZT') });
export const companyUpdateSchema = z.object({ name: name.optional(), baseCurrency: baseCurrency.optional() });
