import { z } from 'zod';
import { nameField } from '../text';

export const CATEGORY_NAME_MAX = 100;

const kind = z.enum(['income', 'expense'], { message: 'Неверный вид статьи' });
const id = z.number().int().positive();

export const categoryCreateSchema = z.object({
  kind,
  name: nameField(CATEGORY_NAME_MAX),
  parentId: id.nullable().default(null),
});

export const categoryUpdateSchema = z.object({ name: nameField(CATEGORY_NAME_MAX) });

/**
 * Новый порядок детей parentId (null — верхний уровень) в дереве kind. `moving` — единственная статья,
 * которая переносится сюда из другого места; null — только смена порядка.
 */
export const categoryReorderSchema = z.object({
  kind,
  parentId: id.nullable(),
  ids: z.array(id).max(1000, 'Слишком длинный список'),
  moving: id.nullable().default(null),
});
