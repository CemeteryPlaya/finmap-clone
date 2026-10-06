import { MutationCache, QueryCache, QueryClient, useQuery } from '@tanstack/react-query';
import { api, ApiError } from './api';

/** Сессия истекла: сбрасываем кэш и уходим на вход (на самой странице входа ничего не делаем). */
export function handleUnauthorized(err: unknown): void {
  if (!(err instanceof ApiError) || err.status !== 401) return;
  if (window.location.pathname === '/login') return;
  queryClient.clear();
  window.location.assign('/login');
}

export const queryClient: QueryClient = new QueryClient({
  // 401 на /auth/me — обычный первый заход без сессии: RequireAuth сам уводит на вход без перезагрузки
  queryCache: new QueryCache({ onError: (err, query) => (query.queryKey[0] === 'me' ? undefined : handleUnauthorized(err)) }),
  mutationCache: new MutationCache({ onError: handleUnauthorized }),
  defaultOptions: {
    queries: {
      retry: (count, err) => !(err instanceof ApiError && err.status >= 400 && err.status < 500) && count < 2,
      refetchOnWindowFocus: false,
    },
  },
});

export interface Me {
  user: { id: number; login: string; name: string };
}

export function useMe() {
  return useQuery<Me, ApiError>({ queryKey: ['me'], queryFn: () => api<Me>('/auth/me') });
}

export function useMeta() {
  return useQuery<{ appName: string }, ApiError>({
    queryKey: ['meta'],
    queryFn: () => api('/meta'),
    staleTime: Infinity,
  });
}
