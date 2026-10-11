import { MutationObserver, type InfiniteData } from '@tanstack/react-query';
import { useMemo, useRef } from 'react';
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
 * ⟳ «Обновить» (§2.5 этапа 1.5): то же, что после записи, но сбой перечитывания журнала не проглатывается
 * (`throwOnError`; без него invalidateQueries всегда завершается успешно) — панель «Ещё» скажет
 * «Не удалось обновить журнал». Загруженные страницы журнала перечитываются на месте.
 */
export async function refreshOperations(companyId: number): Promise<void> {
  const [journal] = await Promise.allSettled([
    queryClient.invalidateQueries({ queryKey: ['journal', companyId] }, { throwOnError: true }),
    queryClient.invalidateQueries({ queryKey: ['accounts', companyId] }),
    queryClient.invalidateQueries({ queryKey: ['companies'] }),
  ]);
  if (journal.status === 'rejected') throw journal.reason;
}

/**
 * Текст ошибки записи для пользователя. На конфликт версии (409) — что журнал обновлён: операцию изменили
 * («…проверьте и повторите») или удалили (повторять нечего).
 */
export function operationErrorText(e: unknown): string {
  if (!(e instanceof ApiError)) return 'Ошибка сервера';
  if (e.status !== 409) return e.message;
  if (e.message.startsWith('Операция удалена')) return 'Операция удалена другим пользователем. Журнал обновлён.';
  return `${e.message.replace(/\.$/, '')}. Журнал обновлён — проверьте и повторите.`;
}

type JournalData = InfiniteData<JournalPageData, string | null>;

interface AssignVars {
  item: JournalItem;
  field: AssignField;
  id: number;
}

/** Ответ PATCH /operations/:id: операция с новой версией. */
interface SavedOperation {
  operation: Pick<JournalItem, 'version' | 'updatedAt' | 'counterpartyId' | 'lines'>;
}

/** Операция в загруженных страницах журнала (любого фильтра) — свежее, чем строка, на которую нажали «Указать». */
export function cachedOperation(companyId: number, id: number): JournalItem | undefined {
  let best: JournalItem | undefined;
  // в кэше могут лежать и неактивные страницы старых фильтров — берётся самая свежая версия, а не первая найденная
  for (const [, data] of queryClient.getQueriesData<JournalData>({ queryKey: ['journal', companyId] })) {
    for (const page of data?.pages ?? []) {
      const found = page.items.find((x) => x.id === id);
      if (found && (!best || found.version > best.version)) best = found;
    }
  }
  return best;
}

const operationScope = (id: number) => `operation-${id}`;

/**
 * «Указать» (§7): значение видно сразу (оптимистично), PATCH с version; при ошибке — откат и текст ошибки,
 * в любом случае журнал, счета и компании перечитываются. Выборы в одной операции идут по очереди (scope),
 * и каждый берёт версию из кэша — после ответа предыдущего, а не ту, что была на строке при нажатии.
 */
export function useAssign(companyId: number, onError: (message: string) => void) {
  const onErrorRef = useRef(onError);
  onErrorRef.current = onError;
  return useMemo(() => ({ mutate: (vars: AssignVars) => runAssign(companyId, vars, (m) => onErrorRef.current(m)) }), [companyId]);
}

/** Одно «Указать»: свой observer, который снимается по завершении, — иначе мутация (с переменными и снимком журнала) остаётся в кэше. */
export function runAssign(companyId: number, vars: AssignVars, onError: (message: string) => void): Promise<unknown> {
  // в очереди за предыдущим «Указать» той же операции версию берём из кэша в момент запроса (после его ответа); иначе — ту, с которой
  // открыто окно: чужая правка, пришедшая при открытом окне, даёт обычный 409 «Загрузить актуальную», а не молчаливую перезапись
  const chained = queryClient.isMutating({ predicate: (m) => m.options.scope?.id === operationScope(vars.item.id) }) > 0;
  const observer = new MutationObserver<SavedOperation, unknown, AssignVars, { snapshot: [readonly unknown[], JournalData | undefined][] }>(queryClient, {
          gcTime: 0,
          scope: { id: operationScope(vars.item.id) },
          mutationFn: ({ item, field, id }) =>
            api<SavedOperation>(`/companies/${companyId}/operations/${item.id}`, {
              method: 'PATCH',
              body: assignPatch(chained ? (cachedOperation(companyId, item.id) ?? item) : item, field, id),
            }),
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
          onSuccess: ({ operation }, { item }) => {
            // после ответа в кэше новая версия: следующий «Указать» в этой строке уйдёт с ней, а не с устаревшей.
            // Контрагент и строки — только если за этой правкой в очереди нет других: иначе они затёрли бы их оптимистичные значения
            const queued = queryClient.isMutating({ predicate: (m) => m.options.scope?.id === operationScope(item.id) }) > 1;
            queryClient.setQueriesData<JournalData>({ queryKey: ['journal', companyId] }, (data) =>
              data && {
                ...data,
                pages: data.pages.map((p) => ({
                  ...p,
                  items: p.items.map((x) =>
                    x.id === item.id
                      ? { ...x, version: operation.version, updatedAt: operation.updatedAt, ...(queued ? {} : { counterpartyId: operation.counterpartyId, lines: operation.lines }) }
                      : x,
                  ),
                })),
              },
            );
          },
          onError: (e, _vars, ctx) => {
            for (const [key, data] of ctx?.snapshot ?? []) queryClient.setQueryData(key, data);
            onError(operationErrorText(e));
          },
          onSettled: () => invalidateOperations(companyId),
  });
  return (
    observer
      .mutate(vars)
      // ошибку показал onError; здесь она не должна уйти необработанной
      .catch(() => undefined)
      .finally(() => observer.reset())
  );
}

/** Массовое действие над выбранными операциями (§7); журнал, счета и компании перечитываются и при ошибке. */
export async function runBulk(companyId: number, ids: number[], action: BulkAction): Promise<BulkResult> {
  try {
    return await api<BulkResult>(`/companies/${companyId}/operations/bulk`, { method: 'POST', body: { ...action, ids } });
  } finally {
    void invalidateOperations(companyId);
  }
}
