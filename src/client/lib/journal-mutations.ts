import { useMutation, type InfiniteData } from '@tanstack/react-query';
import { api, ApiError } from './api';
import { assignPatch, withAssigned, type AssignField } from './journal-assign';
import type { BulkAction, BulkResult } from './journal-bulk';
import type { JournalItem, JournalPageData } from './queries';
import { queryClient } from './query';

/**
 * После любого изменения операций — «Указать», массовые действия, форма операции (шаг 6):
 * журнал, счета (балансы и `hasOperations`) и компании (`currencyLocked`, итоги в переключателе).
 */
export async function invalidateOperations(companyId: number): Promise<void> {
  await Promise.all([
    queryClient.invalidateQueries({ queryKey: ['journal', companyId] }),
    queryClient.invalidateQueries({ queryKey: ['accounts', companyId] }),
    queryClient.invalidateQueries({ queryKey: ['companies'] }),
  ]);
}

/**
 * Текст ошибки записи для пользователя. На конфликт версии (409) — что журнал обновлён: операцию изменили
 * («…проверьте и повторите») или удалили (повторять нечего).
 */
export function operationErrorText(e: unknown): string {
  if (!(e instanceof ApiError)) return 'Ошибка сервера';
  if (e.status !== 409) return e.message;
  return e.message.startsWith('Операция удалена') ? 'Операция удалена другим пользователем. Журнал обновлён.' : `${e.message}. Журнал обновлён — проверьте и повторите.`;
}

type JournalData = InfiniteData<JournalPageData, string | null>;

interface AssignVars {
  item: JournalItem;
  field: AssignField;
  id: number;
}

/**
 * «Указать» (§7): значение видно сразу (оптимистично), PATCH с version; при ошибке — откат и текст ошибки,
 * в любом случае журнал, счета и компании перечитываются.
 */
export function useAssign(companyId: number, onError: (message: string) => void) {
  return useMutation<unknown, unknown, AssignVars, { snapshot: [readonly unknown[], JournalData | undefined][] }>({
    mutationFn: ({ item, field, id }) => api(`/companies/${companyId}/operations/${item.id}`, { method: 'PATCH', body: assignPatch(item, field, id) }),
    onMutate: async ({ item, field, id }) => {
      await queryClient.cancelQueries({ queryKey: ['journal', companyId] });
      const snapshot = queryClient.getQueriesData<JournalData>({ queryKey: ['journal', companyId] });
      queryClient.setQueriesData<JournalData>({ queryKey: ['journal', companyId] }, (data) =>
        data && {
          ...data,
          pages: data.pages.map((p) => ({ ...p, items: p.items.map((x) => (x.id === item.id ? withAssigned(x, field, id) : x)) })),
        },
      );
      return { snapshot };
    },
    onError: (e, _vars, ctx) => {
      for (const [key, data] of ctx?.snapshot ?? []) queryClient.setQueryData(key, data);
      onError(operationErrorText(e));
    },
    onSettled: () => invalidateOperations(companyId),
  });
}

/** Массовое действие над выбранными операциями (§7); журнал, счета и компании перечитываются и при ошибке. */
export async function runBulk(companyId: number, ids: number[], action: BulkAction): Promise<BulkResult> {
  try {
    return await api<BulkResult>(`/companies/${companyId}/operations/bulk`, { method: 'POST', body: { ...action, ids } });
  } finally {
    void invalidateOperations(companyId);
  }
}
