import { QueryClient, useQuery } from '@tanstack/react-query';
import { api, ApiError } from './api';

export const queryClient = new QueryClient({
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
