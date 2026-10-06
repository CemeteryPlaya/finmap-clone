import { z } from 'zod';
import { COUNTERPARTY_TYPES } from '../counterparties';
import { nameField } from '../text';

export const COUNTERPARTY_NAME_MAX = 200;
export const COUNTERPARTY_COMMENT_MAX = 1000;

const type = z.enum(COUNTERPARTY_TYPES, { message: 'Выберите тип контрагента' });
/** Пустой комментарий хранится как null. */
const comment = z
  .string()
  .trim()
  .max(COUNTERPARTY_COMMENT_MAX, `Не длиннее ${COUNTERPARTY_COMMENT_MAX} символов`)
  .nullable()
  .transform((v) => v || null);

export const counterpartyCreateSchema = z.object({
  type,
  name: nameField(COUNTERPARTY_NAME_MAX),
  comment: comment.optional(),
});

export const counterpartyUpdateSchema = z.object({
  type: type.optional(),
  name: nameField(COUNTERPARTY_NAME_MAX).optional(),
  comment: comment.optional(),
});
