import { and, count, countDistinct, eq, isNull, min, or } from 'drizzle-orm';
import { todayInTimezone } from '../../../shared/dates';
import type { Db } from '../../db/client';
import { operationLines, operations, operationTags } from '../../db/schema';

export type ReferenceEntity = 'account' | 'category' | 'project' | 'counterparty' | 'tag';

/**
 * Ссылки операций на справочники (инвариант 9) — интерфейс сервиса операций.
 * До шага 4 операций нет: заглушка отвечает «ссылок нет». Шаг 4 подставляет настоящую реализацию с тестами.
 */
export interface ReferencesService {
  /** Сколько операций (включая мягко удалённые) ссылается на элемент справочника. */
  countOperations(entity: ReferenceEntity, id: number): number;
  /** Дата самой ранней операции счёта (`YYYY-MM-DD` в APP_TIMEZONE); null — операций нет. */
  earliestOperationDate(accountId: number): string | null;
}

export function createReferencesService(): ReferencesService {
  return { countOperations: () => 0, earliestOperationDate: () => null };
}

/** Настоящая реализация на таблицах операций (шаг 4). Ссылки считают и мягко удалённые операции (инвариант 9). */
export function createOperationsReferences(db: Db, timezone: string): ReferencesService {
  return {
    countOperations(entity, id) {
      switch (entity) {
        case 'account':
          return (
            db
              .select({ n: count() })
              .from(operations)
              .where(or(eq(operations.accountId, id), eq(operations.toAccountId, id)))
              .get()?.n ?? 0
          );
        case 'counterparty':
          return db.select({ n: count() }).from(operations).where(eq(operations.counterpartyId, id)).get()?.n ?? 0;
        case 'category':
          return db.select({ n: countDistinct(operationLines.operationId) }).from(operationLines).where(eq(operationLines.categoryId, id)).get()?.n ?? 0;
        case 'project':
          return db.select({ n: countDistinct(operationLines.operationId) }).from(operationLines).where(eq(operationLines.projectId, id)).get()?.n ?? 0;
        case 'tag':
          return db.select({ n: count() }).from(operationTags).where(eq(operationTags.tagId, id)).get()?.n ?? 0;
      }
    },

    earliestOperationDate(accountId) {
      // только неудалённые: удалённая операция при восстановлении снова проверит openedAt (инвариант 11)
      const row = db
        .select({ first: min(operations.paidAt) })
        .from(operations)
        .where(and(or(eq(operations.accountId, accountId), eq(operations.toAccountId, accountId)), isNull(operations.deletedAt)))
        .get();
      return row?.first ? todayInTimezone(timezone, new Date(row.first)) : null;
    },
  };
}
