import { useMutation } from '@tanstack/react-query';
import { useEffect } from 'react';
import { Navigate, useNavigate } from 'react-router';
import { api } from '../lib/api';
import { queryClient, useMe, useMeta } from '../lib/query';

export function AppShell() {
  const me = useMe();
  const meta = useMeta();
  const navigate = useNavigate();
  const logout = useMutation({
    mutationFn: () => api<void>('/auth/logout', { method: 'POST' }),
    onSettled: () => {
      queryClient.clear();
      navigate('/login', { replace: true });
    },
  });

  useEffect(() => {
    if (meta.data) document.title = meta.data.appName;
  }, [meta.data]);

  if (me.isPending) return <div className="p-8 text-muted">Загрузка…</div>;
  if (me.error?.status === 401) return <Navigate to="/login" replace />;
  if (me.error) return <div className="p-8 text-expense">{me.error.message}</div>;

  return (
    <div className="min-h-dvh bg-chrome">
      <header className="flex items-center justify-between px-6 py-4 text-white">
        <span className="text-lg font-bold">{meta.data?.appName}</span>
        <div className="flex items-center gap-4">
          <span className="text-sm text-white/70">{me.data.user.name}</span>
          <button
            onClick={() => logout.mutate()}
            className="rounded-xl bg-chrome-2 px-4 py-2 text-sm hover:bg-white/10"
          >
            Выйти
          </button>
        </div>
      </header>
      <main className="mx-4 min-h-[calc(100dvh-5rem)] rounded-t-3xl bg-card p-8">
        <h1 className="text-2xl font-bold">Журнал</h1>
        <p className="mt-2 text-muted">Журнал операций появится на следующих шагах.</p>
      </main>
    </div>
  );
}
