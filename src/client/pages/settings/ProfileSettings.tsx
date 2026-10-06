import { useMutation } from '@tanstack/react-query';
import { useState, type FormEvent } from 'react';
import { useOutletContext } from 'react-router';
import { Field } from '../../components/Field';
import { Pending } from '../../components/QueryState';
import { btnPrimary, inputClass } from '../../components/ui';
import { api, type ApiError } from '../../lib/api';
import { queryClient, useMe, type Me } from '../../lib/query';
import type { CompanyOutletContext } from '../CompanyLayout';
import { SettingsNav } from './SettingsNav';

const card = 'space-y-4 rounded-2xl border border-field p-4';

function NameCard({ user }: { user: Me['user'] }) {
  const [name, setName] = useState(user.name);
  const save = useMutation<unknown, ApiError>({
    mutationFn: () => api(`/users/${user.id}`, { method: 'PATCH', body: { name } }),
    onSuccess: () =>
      Promise.all([queryClient.invalidateQueries({ queryKey: ['me'] }), queryClient.invalidateQueries({ queryKey: ['users'] })]),
  });
  return (
    <form
      noValidate
      onSubmit={(e) => {
        e.preventDefault();
        save.mutate();
      }}
      className={card}
    >
      <h2 className="text-lg font-semibold">Имя</h2>
      <p className="text-sm text-muted">Логин: {user.login}</p>
      <Field label="Имя" error={save.error?.fields?.name}>
        {(c) => (
          <input
            {...c}
            value={name}
            onChange={(e) => {
              setName(e.target.value);
              save.reset();
            }}
            className={inputClass}
          />
        )}
      </Field>
      {save.isSuccess && (
        <p role="status" className="text-sm text-muted">
          Имя сохранено
        </p>
      )}
      <button type="submit" disabled={save.isPending || !name.trim() || name.trim() === user.name} className={btnPrimary}>
        Сохранить имя
      </button>
    </form>
  );
}

function PasswordCard() {
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [again, setAgain] = useState('');
  const [mismatch, setMismatch] = useState(false);
  const change = useMutation<unknown, ApiError>({
    mutationFn: () => api('/auth/password', { method: 'POST', body: { currentPassword: current, newPassword: next } }),
    onSuccess: () => {
      setCurrent('');
      setNext('');
      setAgain('');
    },
  });
  const fields = change.error?.fields ?? {};
  const submit = (e: FormEvent) => {
    e.preventDefault();
    change.reset();
    if (next !== again) {
      setMismatch(true);
      return;
    }
    setMismatch(false);
    change.mutate();
  };
  return (
    <form noValidate onSubmit={submit} className={card}>
      <h2 className="text-lg font-semibold">Пароль</h2>
      <Field label="Текущий пароль" error={fields.currentPassword}>
        {(c) => <input {...c} type="password" autoComplete="current-password" value={current} onChange={(e) => setCurrent(e.target.value)} className={inputClass} />}
      </Field>
      <Field label="Новый пароль" error={fields.newPassword} hint="Не короче 10 символов">
        {(c) => <input {...c} type="password" autoComplete="new-password" value={next} onChange={(e) => setNext(e.target.value)} className={inputClass} />}
      </Field>
      <Field label="Повторите новый пароль" error={mismatch ? 'Пароли не совпадают' : undefined}>
        {(c) => <input {...c} type="password" autoComplete="new-password" value={again} onChange={(e) => setAgain(e.target.value)} className={inputClass} />}
      </Field>
      {change.isSuccess && (
        <p role="status" className="text-sm text-income">
          Пароль изменён. Остальные сеансы завершены.
        </p>
      )}
      {change.error && !change.error.fields && (
        <p role="alert" className="rounded-xl bg-expense-soft px-4 py-3 text-sm text-expense">
          {change.error.message}
        </p>
      )}
      <button type="submit" disabled={change.isPending || !current || !next || !again} className={btnPrimary}>
        Сменить пароль
      </button>
    </form>
  );
}

export function ProfileSettings() {
  const { company } = useOutletContext<CompanyOutletContext>();
  const me = useMe();
  if (!me.data) return <Pending queries={[me]} />;
  return (
    <section>
      <SettingsNav companyId={company.id} />
      <h1 className="mb-4 text-2xl font-bold">Профиль</h1>
      <div className="grid max-w-4xl gap-6 lg:grid-cols-2">
        <NameCard key={me.data.user.id} user={me.data.user} />
        <PasswordCard />
      </div>
    </section>
  );
}
