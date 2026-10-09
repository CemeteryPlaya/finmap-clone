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
    // в PWA на iPhone строка состояния прозрачная (black-translucent): шапка начинается ниже выреза экрана.
    // На телефоне — одна строка: «Счета», компания, «Выйти»; название продукта (если слева есть что-то ещё)
    // и имя пользователя — только на компьютере
    <header className="flex items-center justify-between gap-x-4 gap-y-2 px-4 pb-3 pt-[max(0.75rem,env(safe-area-inset-top))] text-white md:flex-wrap md:px-6 md:pb-4 md:pt-[max(1rem,env(safe-area-inset-top))]">
      <div className="flex min-w-0 items-center gap-2 md:gap-4">
        <span className={`shrink-0 text-lg font-bold ${left ? 'hidden md:inline' : ''}`}>{meta.data?.appName}</span>
        {left}
      </div>
      {actions}
      <div className="flex shrink-0 items-center gap-4">
        {profileHref ? (
          <Link to={profileHref} className="hidden text-sm text-white/70 underline-offset-4 hover:text-white hover:underline md:inline">
            {me.data?.user.name}
          </Link>
        ) : (
          <span className="hidden text-sm text-white/70 md:inline">{me.data?.user.name}</span>
        )}
        <button onClick={() => logout.mutate()} className="rounded-xl bg-chrome-2 px-4 py-2 text-sm hover:bg-white/10">
          Выйти
        </button>
      </div>
    </header>
  );
}
