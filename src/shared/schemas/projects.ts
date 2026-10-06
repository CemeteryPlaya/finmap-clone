import { z } from 'zod';
import { nameField } from '../text';

const name = nameField(100);
const params = z.record(z.string(), z.unknown());

export const projectCreateSchema = z.object({
  name,
  templateKey: z.string().min(1, 'Выберите тип бизнеса'),
  templateParams: params.default({}),
});

export const projectUpdateSchema = z.object({ name: name.optional(), templateParams: params.optional() });
