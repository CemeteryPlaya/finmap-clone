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
