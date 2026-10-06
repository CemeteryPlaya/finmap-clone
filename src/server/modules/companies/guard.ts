import { eq } from 'drizzle-orm';
import type { Executor } from '../../db/client';
import { companies } from '../../db/schema';
import { AppError } from '../../errors';

/**
 * Компания по id: 404, если её нет; 422 ARCHIVED_REFERENCE при записи в архивную.
 * Отдельно от CompaniesService, чтобы сервисы справочников не зависели от него по кругу.
 */
export function requireCompany(ex: Executor, id: number, opts: { writable?: boolean } = {}): typeof companies.$inferSelect {
  const row = ex.select().from(companies).where(eq(companies.id, id)).get();
  if (!row) throw new AppError(404, 'NOT_FOUND', 'Компания не найдена');
  if (opts.writable && row.archivedAt) throw new AppError(422, 'ARCHIVED_REFERENCE', 'Компания в архиве — изменения недоступны');
  return row;
}
