import { z } from 'zod';
import { nameField } from '../text';

export const PROJECT_NAME_MAX = 100;
const name = nameField(PROJECT_NAME_MAX);
const params = z.record(z.string(), z.unknown());

export const projectCreateSchema = z.object({
  name,
  templateKey: z.string().min(1, 'Выберите тип бизнеса'),
  templateParams: params.default({}),
});

export const projectUpdateSchema = z.object({
  name: name.optional(),
  templateParams: params.optional(),
  /** Переименовать счета шаблона («Касса {старое}» → «Касса {новое}»). */
  renameAccounts: z.boolean().optional(),
});
