import { z } from 'zod';

/** Новый порядок группы: полный список id без повторов. */
export const reorderSchema = z.object({
  ids: z.array(z.number().int().positive()).max(5000, 'Слишком длинный список'),
});
