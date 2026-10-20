import { and, count, countDistinct, eq, isNull, min, or, type SQL } from 'drizzle-orm';
import { todayInTimezone } from '../../../shared/dates';
import type { Db } from '../../db/client';
import { first } from '../../db/raw';
import { operationLines, operations, operationTags, stockDocs, stockWarehouses } from '../../db/schema';

export type ReferenceEntity = 'account' | 'category' | 'project' | 'counterparty' | 'tag';

/**
 * Ссылки операций на справочники (инвариант 9) — интерфейс сервиса операций.
 * Заглушка createReferencesService («ссылок нет») — значение по умолчанию для модульных тестов;
 * приложение использует createOperationsReferences.
 */
export interface ReferencesService {
  /** Сколько операций (включая мягко удалённые) ссылается на элемент справочника. */
  countOperations(entity: ReferenceEntity, id: number): Promise<number>;
  /** Дата самой ранней операции счёта (`YYYY-MM-DD` в APP_TIMEZONE); null — операций нет. */
  earliestOperationDate(accountId: number): Promise<string | null>;
}

export function createReferencesService(): ReferencesService {
  return { countOperations: async () => 0, earliestOperationDate: async () => null };
}

/** Настоящая реализация на таблицах операций (шаг 4). Ссылки считают и мягко удалённые операции (инвариант 9). */
export function createOperationsReferences(db: Db, timezone: string): ReferencesService {
  const n = async (q: PromiseLike<{ n: number }[]>) => Number((await first(q))?.n ?? 0);
  const ops = (where: SQL | undefined) => db.select({ n: count() }).from(operations).where(where);
  return {
    async countOperations(entity, id) {
      switch (entity) {
        case 'account':
          return n(ops(or(eq(operations.accountId, id), eq(operations.toAccountId, id))));
        case 'counterparty':
          // документы склада (поставщик, покупатель) ссылаются на контрагента так же, как операции
          return (await n(ops(eq(operations.counterpartyId, id)))) + (await n(db.select({ n: count() }).from(stockDocs).where(eq(stockDocs.counterpartyId, id))));
        case 'category':
          return n(db.select({ n: countDistinct(operationLines.operationId) }).from(operationLines).where(eq(operationLines.categoryId, id)));
        case 'project':
          // склад проекта — тоже ссылка: проект со складом можно только перевести в архив
          return (
            (await n(db.select({ n: countDistinct(operationLines.operationId) }).from(operationLines).where(eq(operationLines.projectId, id)))) +
            (await n(db.select({ n: count() }).from(stockWarehouses).where(eq(stockWarehouses.projectId, id))))
          );
        case 'tag':
          return n(db.select({ n: count() }).from(operationTags).where(eq(operationTags.tagId, id)));
      }
    },

    async earliestOperationDate(accountId) {
      // только неудалённые: удалённая операция при восстановлении снова проверит openedAt (инвариант 11)
      const row = await first(
        db
          .select({ first: min(operations.paidAt) })
          .from(operations)
          .where(and(or(eq(operations.accountId, accountId), eq(operations.toAccountId, accountId)), isNull(operations.deletedAt))),
      );
      return row?.first ? todayInTimezone(timezone, new Date(row.first)) : null;
    },
  };
}
