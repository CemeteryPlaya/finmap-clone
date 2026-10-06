import { z } from 'zod';

const name = z.string().trim().min(1, 'Введите название').max(100, 'Не длиннее 100 символов');
const params = z.record(z.string(), z.unknown());

export const projectCreateSchema = z.object({
  name,
  templateKey: z.string().min(1, 'Выберите тип бизнеса'),
  templateParams: params.default({}),
});

export const projectUpdateSchema = z.object({ name: name.optional(), templateParams: params.optional() });
