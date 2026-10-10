import { useMutation } from '@tanstack/react-query';
import { useState } from 'react';
import { useOutletContext } from 'react-router';
import { Field } from '../../components/Field';
import { Pending, StaleNotice } from '../../components/QueryState';
import { btnPrimary, btnSecondary, btnSmall, inputClass } from '../../components/ui';
import { api, type ApiError } from '../../lib/api';
import { queryClient, useMe } from '../../lib/query';
import { useUsers, type AppUser } from '../../lib/queries';
import type { CompanyOutletContext } from '../CompanyLayout';
import { SHARED_NOTE } from '../../lib/settings-sections';

const badge = 'ml-2 rounded-full bg-field px-2 py-0.5 text-xs font-normal text-muted';
const invalidateUsers = () =>
  Promise.all([queryClient.invalidateQueries({ queryKey: ['users'] }), queryClient.invalidateQueries({ queryKey: ['me'] })]);

function NewUserForm({ onDone }: { onDone: () => void }) {
  const [login, setLogin] = useState('');
  const [name, setName] = useState('');
  const [password, setPassword] = useState('');
  const create = useMutation<unknown, ApiError>({
    mutationFn: () => api('/users', { method: 'POST', body: { login, name, password } }),
    onSuccess: async () => {
      await invalidateUsers();
      onDone();
    },
  });
  const fields = create.error?.fields ?? {};
  return (
    <form
      noValidate
      onSubmit={(e) => {
        e.preventDefault();
        create.mutate();
      }}
      className="grid gap-3 rounded-2xl bg-canvas p-4 md:grid-cols-3 md:items-start"
    >
      <Field label="Логин" error={fields.login} hint="Латиница, цифры, точка, дефис">
        {(c) => <input {...c} autoFocus autoComplete="off" value={login} onChange={(e) => setLogin(e.target.value)} className={inputClass} />}
      </Field>
      <Field label="Имя" error={fields.name}>
        {(c) => <input {...c} value={name} onChange={(e) => setName(e.target.value)} className={inputClass} />}
      </Field>
      <Field label="Пароль" error={fields.password} hint="Не короче 10 символов">
        {(c) => <input {...c} type="password" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} className={inputClass} />}
      </Field>
      {create.error && !create.error.fields && (
        <p role="alert" className="rounded-xl bg-expense-soft px-4 py-3 text-sm text-expense md:col-span-3">
          {create.error.message}
        </p>
      )}
      <div className="flex gap-2 md:col-span-3">
        <button type="submit" disabled={create.isPending || !login.trim() || !password} className={btnPrimary}>
          Создать пользователя
        </button>
        <button type="button" onClick={onDone} className={btnSecondary}>
          Отмена
        </button>
      </div>
    </form>
  );
}

function UserItem({ u, isMe }: { u: AppUser; isMe: boolean }) {
  const [mode, setMode] = useState<'view' | 'rename' | 'password'>('view');
  const [name, setName] = useState(u.name);
  const [password, setPassword] = useState('');
  const [notice, setNotice] = useState<string | null>(null);
  const patch = useMutation<unknown, ApiError, { name?: string; password?: string; disabled?: boolean }>({
    mutationFn: (body) => api(`/users/${u.id}`, { method: 'PATCH', body }),
    onSuccess: async (_data, body) => {
      await invalidateUsers();
      setMode('view');
      setPassword('');
      if (body.password !== undefined) setNotice('Пароль сброшен, сеансы пользователя завершены');
      else if (body.disabled === true) setNotice('Пользователь отключён, его сеансы завершены');
      else setNotice(null);
    },
  });
  const open = (next: 'view' | 'rename' | 'password') => {
    patch.reset();
    setNotice(null);
    setName(u.name);
    setPassword('');
    setMode(next);
  };
  const fields = patch.error?.fields ?? {};

  return (
    <li className={`rounded-2xl border border-field p-4 ${u.disabledAt ? 'opacity-60' : ''}`}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <div className="font-semibold">
            {u.name}
            {isMe && <span className={badge}>это вы</span>}
            {u.disabledAt && <span className={badge}>отключён</span>}
          </div>
          <div className="text-sm text-muted">{u.login}</div>
        </div>
        {mode === 'view' && (
          <div className="flex flex-wrap gap-2">
            <button type="button" onClick={() => open('rename')} className={btnSmall}>
              Переименовать
            </button>
            {!isMe && (
              <button type="button" onClick={() => open('password')} className={btnSmall}>
                Сбросить пароль
              </button>
            )}
            {!isMe && (
              <button
                type="button"
                onClick={() => {
                  open('view');
                  patch.mutate({ disabled: !u.disabledAt });
                }}
                className={btnSmall}
              >
                {u.disabledAt ? 'Включить' : 'Отключить'}
              </button>
            )}
          </div>
        )}
      </div>
      {mode === 'rename' && (
        <form
          noValidate
          onSubmit={(e) => {
            e.preventDefault();
            patch.mutate({ name });
          }}
          className="mt-3 flex flex-wrap items-start gap-2"
        >
          <Field label={`Новое имя для ${u.login}`} error={fields.name} className="min-w-64 flex-1">
            {(c) => <input {...c} autoFocus value={name} onChange={(e) => setName(e.target.value)} className={inputClass} />}
          </Field>
          <div className="flex gap-2 md:mt-6">
            <button type="submit" disabled={patch.isPending || !name.trim()} className={btnPrimary}>
              Сохранить
            </button>
            <button type="button" onClick={() => open('view')} className={btnSecondary}>
              Отмена
            </button>
          </div>
        </form>
      )}
      {mode === 'password' && (
        <form
          noValidate
          onSubmit={(e) => {
            e.preventDefault();
            patch.mutate({ password });
          }}
          className="mt-3 flex flex-wrap items-start gap-2"
        >
          <Field
            label={`Новый пароль для ${u.login}`}
            error={fields.password}
            hint="Не короче 10 символов. Сеансы пользователя будут завершены."
            className="min-w-64 flex-1"
          >
            {(c) => (
              <input {...c} autoFocus type="password" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} className={inputClass} />
            )}
          </Field>
          <div className="flex gap-2 md:mt-6">
            <button type="submit" disabled={patch.isPending || !password} className={btnPrimary}>
              Сбросить пароль
            </button>
            <button type="button" onClick={() => open('view')} className={btnSecondary}>
              Отмена
            </button>
          </div>
        </form>
      )}
      {notice && (
        <p role="status" className="mt-2 text-sm text-muted">
          {notice}
        </p>
      )}
      {patch.error && !patch.error.fields && (
        <p role="alert" className="mt-2 rounded-xl bg-expense-soft px-4 py-2 text-sm text-expense">
          {patch.error.message}
        </p>
      )}
    </li>
  );
}

export function UsersSettings() {
  const { company } = useOutletContext<CompanyOutletContext>();
  const users = useUsers();
  const me = useMe();
  const [creating, setCreating] = useState(false);
  if (!users.data || !me.data) return <Pending queries={[users, me]} />;
  const meId = me.data.user.id;

  return (
    <section>
      <StaleNotice queries={[users]} />
      <div className="mb-2 flex items-center justify-between gap-4">
        <h1 className="text-2xl font-bold">Пользователи</h1>
        {!creating && (
          <button type="button" onClick={() => setCreating(true)} className={btnPrimary}>
            Добавить пользователя
          </button>
        )}
      </div>
      <p className="mb-1 text-sm font-medium text-muted">{SHARED_NOTE}</p>
      <p className="mb-4 text-sm text-muted">Все пользователи видят все компании. Сброс пароля и отключение сразу завершают сеансы пользователя.</p>
      {creating && (
        <div className="mb-6">
          <NewUserForm onDone={() => setCreating(false)} />
        </div>
      )}
      <ul className="space-y-2">
        {users.data.map((u) => (
          <UserItem key={u.id} u={u} isMe={u.id === meId} />
        ))}
      </ul>
    </section>
  );
}
