import { useMutation } from '@tanstack/react-query';
import { useEffect, type ReactNode } from 'react';
import { Link, useNavigate } from 'react-router';
import { api } from '../lib/api';
import { queryClient, useMe, useMeta } from '../lib/query';

export function AppHeader({ left, actions, profileHref }: { left?: ReactNode; actions?: ReactNode; profileHref?: string }) {
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

  return (
    <header className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 px-6 py-4 text-white">
      <div className="flex min-w-0 items-center gap-4">
        <span className="shrink-0 text-lg font-bold">{meta.data?.appName}</span>
        {left}
      </div>
      {actions}
      <div className="flex shrink-0 items-center gap-4">
        {profileHref ? (
          <Link to={profileHref} className="text-sm text-white/70 underline-offset-4 hover:text-white hover:underline">
            {me.data?.user.name}
          </Link>
        ) : (
          <span className="text-sm text-white/70">{me.data?.user.name}</span>
        )}
        <button onClick={() => logout.mutate()} className="rounded-xl bg-chrome-2 px-4 py-2 text-sm hover:bg-white/10">
          Выйти
        </button>
      </div>
    </header>
  );
}
