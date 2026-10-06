import { useMutation } from '@tanstack/react-query';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router';
import { api, ApiError } from '../lib/api';
import { queryClient, useMeta, type Me } from '../lib/query';

export function LoginPage() {
  const navigate = useNavigate();
  const meta = useMeta();
  const [login, setLogin] = useState('');
  const [password, setPassword] = useState('');
  const [remember, setRemember] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const passwordRef = useRef<HTMLInputElement>(null);

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
        <div className="relative mb-3">
          <label className="block">
            <span className="sr-only">Пароль</span>
            <input
              ref={passwordRef}
              type={showPassword ? 'text' : 'password'}
              autoComplete="current-password"
              placeholder="Пароль"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full rounded-xl bg-field py-3 pl-4 pr-12 outline-none focus:ring-2 focus:ring-focus"
            />
          </label>
          <button
            type="button"
            aria-label={showPassword ? 'Скрыть пароль' : 'Показать пароль'}
            aria-pressed={showPassword}
            title={showPassword ? 'Скрыть пароль' : 'Показать пароль'}
            onClick={() => {
              setShowPassword((v) => !v);
              passwordRef.current?.focus();
            }}
            className="absolute inset-y-0 right-0 flex w-12 items-center justify-center rounded-r-xl text-muted hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus"
          >
            <EyeIcon crossed={showPassword} />
          </button>
        </div>
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

function EyeIcon({ crossed }: { crossed: boolean }) {
  return (
    <svg
      aria-hidden="true"
      width="20"
      height="20"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z" />
      <circle cx="12" cy="12" r="3" />
      {crossed && <path d="M4 4l16 16" />}
    </svg>
  );
}
