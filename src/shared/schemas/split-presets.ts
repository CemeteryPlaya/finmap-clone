import { z } from 'zod';
import { formatBp } from '../percent';
import { nameField } from '../text';

export const SPLIT_TOTAL_BP = 10000;
export const SPLIT_PRESET_NAME_MAX = 100;

const id = z.number().int().positive();

const line = z.object({
  categoryId: id.nullable().default(null),
  projectId: id.nullable().default(null),
  bp: z.number().int('Доля — целое число сотых долей процента').min(1, 'Доля больше 0').max(SPLIT_TOTAL_BP, 'Не больше 100%'),
});

const lines = z
  .array(line)
  .min(1, 'Добавьте хотя бы одну строку')
  .max(20, 'Не больше 20 строк')
  .superRefine((ls, ctx) => {
    if (ls.some((l) => l.categoryId === null && l.projectId === null)) {
      ctx.addIssue({ code: 'custom', message: 'В каждой строке укажите статью или проект' });
      return;
    }
    const keys = ls.map((l) => `${l.categoryId}:${l.projectId}`);
    if (new Set(keys).size !== keys.length) {
      ctx.addIssue({ code: 'custom', message: 'Строки повторяются' });
      return;
    }
    const sum = ls.reduce((s, l) => s + l.bp, 0);
    if (sum !== SPLIT_TOTAL_BP) ctx.addIssue({ code: 'custom', message: `Сумма долей должна быть 100% (сейчас ${formatBp(sum)}%)` });
  });

export const splitPresetCreateSchema = z.object({ name: nameField(SPLIT_PRESET_NAME_MAX), lines });
export const splitPresetUpdateSchema = z.object({ name: nameField(SPLIT_PRESET_NAME_MAX).optional(), lines: lines.optional() });
