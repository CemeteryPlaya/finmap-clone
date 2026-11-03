import { z } from 'zod';
import { TILES_MAX } from '../analytics-catalog';

/** Ключ группы, карточки или плитки каталога: латиница, цифры, дефис, точка. */
const catalogKey = z.string().regex(/^[a-z][a-zA-Z0-9.-]{0,63}$/, 'Неизвестный ключ');
const item = z.object({ key: catalogKey, visible: z.boolean({ message: 'Да или нет' }) });

/** `PUT …/analytics-settings/dashboards` (спецификация «Аналитика клуба», §10.1). */
export const savedDashboardsSchema = z.object({
  groups: z.array(z.object({ key: catalogKey, visible: z.boolean({ message: 'Да или нет' }), cards: z.array(item).max(50) })).max(20),
});

/** `PUT …/analytics-settings/tiles.<шаблон>` (§10.2): видимых не больше 12. */
export const savedTilesSchema = z.object({
  items: z
    .array(item)
    .max(50)
    .refine((items) => items.filter((i) => i.visible).length <= TILES_MAX, `Не больше ${TILES_MAX} плиток`),
});
