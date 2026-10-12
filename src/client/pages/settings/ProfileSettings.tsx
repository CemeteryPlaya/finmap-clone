import { useState, type FormEvent } from 'react';
import { Field } from '../../components/Field';
import { LockIcon } from '../../components/icons';
import { Pending } from '../../components/QueryState';
import { alertClass, btnPrimary, inputClass } from '../../components/ui';
import { api, ApiError } from '../../lib/api';
import { clearEditedFields, profileDirty, profilePlan, profileServerError, type ProfileDraft, type ProfileFields } from '../../lib/profile';
import { queryClient, useMe, type Me } from '../../lib/query';

/**
 * «Профиль» (§7.4 этапа 1.5): одна колонка около 430 px — логин, «Имя», «Изменить пароль» и три поля пароля,
 * одна «Сохранить». Что отправлять, решает `profilePlan`: имя — если изменилось, пароль — если начат.
 */
export function ProfileSettings() {
  const me = useMe();
  if (!me.data) return <Pending queries={[me]} />;
  return (
    <section className="max-w-[430px]">
      <h1 className="mb-6 text-2xl font-bold">Профиль</h1>
      <ProfileForm key={me.data.user.id} user={me.data.user} />
    </section>
  );
}

function ProfileForm({ user }: { user: Me['user'] }) {
  const [draft, setDraft] = useState<ProfileDraft>({ name: user.name, current: '', next: '', again: '' });
  const [fields, setFields] = useState<ProfileFields>({});
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const dirty = profileDirty(draft, user.name);
  const change = (patch: Partial<ProfileDraft>) => {
    setStatus(null);
    setFields((f) => clearEditedFields(f, patch));
    setDraft((d) => ({ ...d, ...patch }));
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    // кнопка с aria-disabled нажимается, Enter в поле тоже отправляет форму
    if (pending || !dirty) return;
    setStatus(null);
    setError(null);
    const plan = profilePlan(draft, user.name);
    if (!plan.ok) {
      setFields(plan.fields);
      return;
    }
    setFields({});
    setPending(true);
    const done: string[] = [];
    try {
      if (plan.name !== null) {
        await api(`/users/${user.id}`, { method: 'PATCH', body: { name: plan.name } });
        await Promise.all([queryClient.invalidateQueries({ queryKey: ['me'] }), queryClient.invalidateQueries({ queryKey: ['users'] })]);
        done.push('Имя сохранено.');
      }
      if (plan.password) {
        await api('/auth/password', { method: 'POST', body: plan.password });
        setDraft((d) => ({ ...d, current: '', next: '', again: '' }));
        done.push('Пароль изменён. Остальные сеансы завершены.');
      }
    } catch (err) {
      const shown = profileServerError(err instanceof ApiError ? err.fields : undefined, err instanceof ApiError ? err.message : 'Ошибка сервера');
      setFields(shown.fields);
      setError(shown.error);
    } finally {
      setPending(false);
      setStatus(done.length > 0 ? done.join(' ') : null);
    }
  };

  return (
    <form noValidate onSubmit={(e) => void submit(e)} className="grid gap-4">
      <p className="text-sm text-muted">Логин: {user.login}</p>
      <Field label="Имя" error={fields.name}>
        {(c) => <input {...c} value={draft.name} onChange={(e) => change({ name: e.target.value })} className={inputClass} />}
      </Field>
      <h2 className="mt-2 flex items-center gap-2 text-lg font-semibold">
        <LockIcon />
        Изменить пароль
      </h2>
      <Field label="Текущий пароль" error={fields.current}>
        {(c) => <input {...c} type="password" autoComplete="current-password" value={draft.current} onChange={(e) => change({ current: e.target.value })} className={inputClass} />}
      </Field>
      <Field label="Новый пароль" hint="Не короче 10 символов" error={fields.next}>
        {(c) => <input {...c} type="password" autoComplete="new-password" value={draft.next} onChange={(e) => change({ next: e.target.value })} className={inputClass} />}
      </Field>
      <Field label="Повторите пароль" error={fields.again}>
        {(c) => <input {...c} type="password" autoComplete="new-password" value={draft.again} onChange={(e) => change({ again: e.target.value })} className={inputClass} />}
      </Field>
      {/* живая область на месте всегда: вставленная сразу с текстом часто не объявляется */}
      <p role="status" className={status ? 'text-sm text-income-strong' : 'sr-only'}>
        {status}
      </p>
      {error && (
        <p role="alert" className={`${alertClass} mb-0`}>
          {error}
        </p>
      )}
      {/* aria-disabled, а не disabled: после сохранения форма не изменена, а фокус остаётся на кнопке (R4) */}
      <button type="submit" aria-disabled={pending || !dirty || undefined} className={`${btnPrimary} aria-disabled:opacity-50`}>
        Сохранить
      </button>
    </form>
  );
}
