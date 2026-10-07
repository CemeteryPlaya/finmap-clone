import { z } from 'zod';
import { nameField } from '../text';
import { journalFilterSchema } from './journal';

export const SAVED_FILTER_NAME_MAX = 100;

/** Сохранённый фильтр журнала: JSON проверяется той же схемой, что строка запроса списка (§4.4, §6). */
export const savedFilterCreateSchema = z.object({ name: nameField(SAVED_FILTER_NAME_MAX), filter: journalFilterSchema });
export const savedFilterUpdateSchema = z.object({ name: nameField(SAVED_FILTER_NAME_MAX).optional(), filter: journalFilterSchema.optional() });
