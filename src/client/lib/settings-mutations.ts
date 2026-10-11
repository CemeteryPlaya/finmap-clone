import { useMutation, type QueryKey } from '@tanstack/react-query';
import { api, type ApiError } from './api';
import { sortByIds } from './order';
import { queryClient } from './query';

/**
 * Новый порядок списка настроек (§7.1 этапа 1.5): POST …/reorder с полным порядком. В кэше порядок меняется
 * сразу; если сервер отказал — прежний порядок и onError(сообщение). onError(null) — перед запросом.
 */
export function useReorder<T extends { id: number }>(queryKey: QueryKey, path: string, onError: (message: string | null) => void) {
  return useMutation<unknown, ApiError, number[], { previous: T[] | undefined }>({
    mutationFn: (ids) => api(path, { method: 'POST', body: { ids } }),
    onMutate: async (ids) => {
      onError(null);
      await queryClient.cancelQueries({ queryKey });
      const previous = queryClient.getQueryData<T[]>(queryKey);
      if (previous) queryClient.setQueryData<T[]>(queryKey, sortByIds(previous, ids));
      return { previous };
    },
    onError: (e, _ids, context) => {
      if (context?.previous) queryClient.setQueryData(queryKey, context.previous);
      onError(e.message);
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey }),
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
  const run = async (a: EntityAction): Promise<boolean> => {
    try {
      await action.mutateAsync(a);
    } catch {
      return false;
    }
    await refresh();
    onDone();
    return true;
  };
  return {
    pending: action.isPending,
    error: action.error?.message ?? null,
    toggleArchive: (archived: boolean) => void run({ suffix: archived ? '/unarchive' : '/archive', method: 'POST' }),
    remove: () => run({ suffix: '', method: 'DELETE' }),
  };
}
