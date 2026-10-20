import { useMutation, type QueryKey, type UseMutationResult } from '@tanstack/react-query';
import { useState } from 'react';
import { api, type ApiError } from './api';
import { sortByIds } from './order';
import { queryClient } from './query';

/** Текст отказа сервера: сообщения полей (отказ переноса категории приходит как ids / parentId) или общее сообщение. */
export const apiErrorText = (e: ApiError) => (e.fields && Object.keys(e.fields).length > 0 ? Object.values(e.fields).join(' ') : e.message);

/** Перестановка не простым списком: тело запроса и новый порядок в кэше (дерево категорий — план MovePlan). */
export interface ReorderShape<TData, TVars> {
  body: (vars: TVars) => unknown;
  apply: (data: TData, vars: TVars) => TData;
}

/**
 * Новый порядок списка настроек (§7.1 этапа 1.5): POST …/reorder с полным порядком. В кэше порядок меняется
 * сразу; если сервер отказал — прежний порядок и onError(сообщение). onError(null) — перед запросом.
 * Быстрые перестановки подряд не мешают друг другу: пока выполняется другая, откат и обновление с сервера
 * откладываются до последней (иначе ответ первой затёр бы показанный порядок третьей).
 * Без shape — список `T[]` и тело `{ ids }`; с shape — свои тело и порядок в кэше (категории, R7 плана 1.5-4b).
 */
export function useReorder<T extends { id: number }>(
  queryKey: QueryKey,
  path: string,
  onError: (message: string | null) => void,
): UseMutationResult<unknown, ApiError, number[], { previous: T[] | undefined }>;
export function useReorder<TData, TVars>(
  queryKey: QueryKey,
  path: string,
  onError: (message: string | null) => void,
  shape: ReorderShape<TData, TVars>,
): UseMutationResult<unknown, ApiError, TVars, { previous: TData | undefined }>;
export function useReorder<TData, TVars>(
  queryKey: QueryKey,
  path: string,
  onError: (message: string | null) => void,
  shape: ReorderShape<TData, TVars> = listShape as unknown as ReorderShape<TData, TVars>,
) {
  const mutationKey = ['reorder', ...queryKey];
  // в onError/onSettled своя мутация ещё считается выполняющейся: «одна» — значит, других нет
  const lastOne = () => queryClient.isMutating({ mutationKey }) === 1;
  return useMutation<unknown, ApiError, TVars, { previous: TData | undefined }>({
    mutationKey,
    mutationFn: (vars) => api(path, { method: 'POST', body: shape.body(vars) }),
    onMutate: async (vars) => {
      onError(null);
      await queryClient.cancelQueries({ queryKey });
      const previous = queryClient.getQueryData<TData>(queryKey);
      if (previous !== undefined) queryClient.setQueryData<TData>(queryKey, shape.apply(previous, vars));
      return { previous };
    },
    // последняя удалась — показанный порядок верен, ошибка более ранней (отказ 409 при другой в пути) устарела
    onSuccess: () => {
      if (lastOne()) onError(null);
    },
    onError: (e, _vars, context) => {
      if (context?.previous !== undefined && lastOne()) queryClient.setQueryData(queryKey, context.previous);
      onError(apiErrorText(e));
    },
    onSettled: () => (lastOne() ? queryClient.invalidateQueries({ queryKey }) : undefined),
  });
}

/** Простой список: тело `{ ids }`, в кэше — тот же список в порядке ids. */
const listShape: ReorderShape<{ id: number }[], number[]> = {
  body: (ids) => ({ ids }),
  apply: (list, ids) => sortByIds(list, ids),
};

type EntityAction = { suffix: '' | '/archive' | '/unarchive'; method: 'POST' | 'DELETE' };

/**
 * «В архив» / «Вернуть из архива» / «Удалить» в окне правки (§7.1 этапа 1.5). path — адрес элемента
 * (`/companies/1/tags/5`). Успех — refresh(), затем onDone() (окно закрывается); ошибка — в `error`, окно остаётся.
 */
export function useEntityActions(path: string, refresh: () => Promise<unknown>, onDone: () => void) {
  const action = useMutation<unknown, ApiError, EntityAction>({
    mutationFn: (a) => api(`${path}${a.suffix}`, { method: a.method }),
  });
  // от нажатия до onDone: во время перечитывания списка кнопки окна не должны снова стать доступными
  const [busy, setBusy] = useState(false);
  const run = async (a: EntityAction): Promise<boolean> => {
    setBusy(true);
    try {
      await action.mutateAsync(a);
    } catch {
      setBusy(false);
      return false;
    }
    try {
      await refresh();
    } finally {
      setBusy(false);
    }
    onDone();
    return true;
  };
  return {
    pending: action.isPending || busy,
    error: action.error?.message ?? null,
    toggleArchive: (archived: boolean) => void run({ suffix: archived ? '/unarchive' : '/archive', method: 'POST' }),
    remove: () => run({ suffix: '', method: 'DELETE' }),
  };
}
