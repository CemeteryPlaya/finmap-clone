/** Не больше операций за одно массовое действие — как у сервера (BULK_MAX плана 5a). */
export const BULK_MAX = 500;

/** Тело POST /companies/:cid/operations/bulk без списка id (план 5a). */
export type BulkAction =
  | { action: 'setCategory'; categoryId: number }
  | { action: 'setProject'; projectId: number }
  | { action: 'setCounterparty'; counterpartyId: number }
  | { action: 'delete' }
  | { action: 'restore' };

export interface BulkResult {
  changed: number[];
  skipped: { id: number; reason: string }[];
}

const TITLES: Record<BulkAction['action'], string> = {
  setCategory: 'Категория',
  setProject: 'Проект',
  setCounterparty: 'Контрагент',
  delete: 'Удаление',
  restore: 'Отмена удаления',
};

export interface BulkSummary {
  text: string;
  reasons: { reason: string; count: number }[];
}

/** Итог массового действия (§7): «Категория: изменено 3, пропущено 2» и причины пропуска с числом операций. */
export function bulkSummary(action: BulkAction['action'], r: BulkResult): BulkSummary {
  const counts = new Map<string, number>();
  for (const s of r.skipped) counts.set(s.reason, (counts.get(s.reason) ?? 0) + 1);
  return {
    text: `${TITLES[action]}: изменено ${r.changed.length}, пропущено ${r.skipped.length}`,
    reasons: [...counts].map(([reason, count]) => ({ reason, count })),
  };
}
