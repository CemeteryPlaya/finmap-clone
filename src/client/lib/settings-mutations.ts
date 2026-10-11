import { useMutation, type QueryKey } from '@tanstack/react-query';
import { useState } from 'react';
import { api, type ApiError } from './api';
import { sortByIds } from './order';
import { queryClient } from './query';

/**
 * Новый порядок списка настроек (§7.1 этапа 1.5): POST …/reorder с полным порядком. В кэше порядок меняется
 * сразу; если сервер отказал — прежний порядок и onError(сообщение). onError(null) — перед запросом.
 * Быстрые перестановки подряд не мешают друг другу: пока выполняется другая, откат и обновление с сервера
 * откладываются до последней (иначе ответ первой затёр бы показанный порядок третьей).
 */
export function useReorder<T extends { id: number }>(queryKey: QueryKey, path: string, onError: (message: string | null) => void) {
  const mutationKey = ['reorder', ...queryKey];
  // в onError/onSettled своя мутация ещё считается выполняющейся: «одна» — значит, других нет
  const lastOne = () => queryClient.isMutating({ mutationKey }) === 1;
  return useMutation<unknown, ApiError, number[], { previous: T[] | undefined }>({
    mutationKey,
    mutationFn: (ids) => api(path, { method: 'POST', body: { ids } }),
    onMutate: async (ids) => {
      onError(null);
      await queryClient.cancelQueries({ queryKey });
      const previous = queryClient.getQueryData<T[]>(queryKey);
      if (previous) queryClient.setQueryData<T[]>(queryKey, sortByIds(previous, ids));
      return { previous };
    },
    // последняя удалась — показанный порядок верен, ошибка более ранней (отказ 409 при другой в пути) устарела
    onSuccess: () => {
      if (lastOne()) onError(null);
    },
    onError: (e, _ids, context) => {
      if (context?.previous && lastOne()) queryClient.setQueryData(queryKey, context.previous);
      onError(e.message);
    },
    onSettled: () => (lastOne() ? queryClient.invalidateQueries({ queryKey }) : undefined),
  });
}

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
