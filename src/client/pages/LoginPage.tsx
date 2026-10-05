import { useMutation } from '@tanstack/react-query';
import { useEffect, useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router';
import { api, ApiError } from '../lib/api';
import { queryClient, useMeta, type Me } from '../lib/query';

export function LoginPage() {
  const navigate = useNavigate();
  const meta = useMeta();
  const [login, setLogin] = useState('');
  const [password, setPassword] = useState('');
  const [remember, setRemember] = useState(false);

  useEffect(() => {
    if (meta.data) document.title = `Вход — ${meta.data.appName}`;
  }, [meta.data]);

  const mutation = useMutation<Me, ApiError>({
    mutationFn: () => api<Me>('/auth/login', { method: 'POST', body: { login, password, remember } }),
    onSuccess: (me) => {
      queryClient.setQueryData(['me'], me);
      navigate('/', { replace: true });
    },
  });

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    mutation.mutate();
  };

  const err = mutation.error;
  return (
    <main className="flex min-h-dvh items-center justify-center bg-chrome px-4">
      <form onSubmit={onSubmit} className="w-full max-w-sm rounded-3xl bg-card p-8 shadow-xl">
        <h1 className="mb-6 text-3xl font-bold">{meta.data?.appName ?? ''}</h1>
        <label className="mb-3 block">
          <span className="sr-only">Логин</span>
          <input
            autoFocus
            autoComplete="username"
            placeholder="Логин"
            value={login}
            onChange={(e) => setLogin(e.target.value)}
            className="w-full rounded-xl bg-field px-4 py-3 outline-none focus:ring-2 focus:ring-focus"
          />
        </label>
        <label className="mb-3 block">
          <span className="sr-only">Пароль</span>
          <input
            type="password"
            autoComplete="current-password"
            placeholder="Пароль"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="w-full rounded-xl bg-field px-4 py-3 outline-none focus:ring-2 focus:ring-focus"
          />
        </label>
        <label className="mb-5 flex items-center gap-2 text-sm text-muted">
          <input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} />
          Запомнить меня на 30 дней
        </label>
        {err && (
          <p role="alert" className="mb-4 rounded-xl bg-expense-soft px-4 py-3 text-sm text-expense">
            {err.fields ? Object.values(err.fields).join('. ') : err.message}
          </p>
        )}
        <button
          type="submit"
          disabled={mutation.isPending || !login || !password}
          className="w-full rounded-xl bg-income py-3 font-semibold text-white disabled:opacity-50"
        >
          {mutation.isPending ? 'Входим…' : 'Войти'}
        </button>
      </form>
    </main>
  );
}
