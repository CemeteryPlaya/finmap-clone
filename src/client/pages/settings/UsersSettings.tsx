import { useMutation } from '@tanstack/react-query';
import { useState } from 'react';
import { Field } from '../../components/Field';
import { Modal } from '../../components/Modal';
import { Pending, StaleNotice } from '../../components/QueryState';
import { SettingsList } from '../../components/SettingsList';
import { alertClass, btnDanger, btnPrimary, btnSecondary, inputClass } from '../../components/ui';
import { api, type ApiError } from '../../lib/api';
import { queryClient, useMe } from '../../lib/query';
import { useUsers, type AppUser } from '../../lib/queries';
import { SHARED_NOTE } from '../../lib/settings-sections';

const invalidateUsers = () =>
  Promise.all([queryClient.invalidateQueries({ queryKey: ['users'] }), queryClient.invalidateQueries({ queryKey: ['me'] })]);

/** Пометка в строке: «это вы», «отключён». */
const userNote = (u: AppUser, meId: number) =>
  [u.id === meId ? 'это вы' : null, u.disabledAt ? 'отключён' : null].filter((s): s is string => s !== null).join(', ') || undefined;

/** Окно пользователя: 'new' — «Новый пользователь», id — «Пользователь» (свежие данные из списка), null — закрыто. */
type Editing = number | 'new' | null;

/**
 * «Пользователи» (§7.4 этапа 1.5): «Добавить пользователя» слева вверху, строки «имя, логин серым, ✎»;
 * ✎ — окно «Пользователь»: имя, сброс пароля, отключение (у себя — только имя). Общие для всех компаний.
 */
export function UsersSettings() {
  const users = useUsers();
  const me = useMe();
  const [editing, setEditing] = useState<Editing>(null);
  if (!users.data || !me.data) return <Pending queries={[users, me]} />;
  const meId = me.data.user.id;
  const list = users.data;
  const current = typeof editing === 'number' ? (list.find((u) => u.id === editing) ?? null) : null;

  return (
    <section>
      <StaleNotice queries={[users]} />
      <h1 className="mb-2 text-2xl font-bold">Пользователи</h1>
      <p className="mb-1 text-sm font-medium text-muted">{SHARED_NOTE}</p>
      <p className="mb-4 text-sm text-muted">Все пользователи видят все компании. Сброс пароля и отключение сразу завершают сеансы пользователя.</p>
      <SettingsList
        label="Пользователи"
        rows={list.map((u) => ({
          id: u.id,
          name: u.name,
          secondary: u.login,
          note: userNote(u, meId),
          archived: u.disabledAt !== null,
          editLabel: `Изменить ${u.name} (${u.login})`,
        }))}
        search={false}
        addLabel="Добавить пользователя"
        onAdd={() => setEditing('new')}
        onEdit={(row) => setEditing(row.id)}
        empty="Пользователей нет."
      />
      <Modal open={editing !== null} title={editing === 'new' ? 'Новый пользователь' : 'Пользователь'} onClose={() => setEditing(null)} className="max-w-lg">
        {editing === 'new' && <NewUserForm onDone={() => setEditing(null)} />}
        {typeof editing === 'number' &&
          (current ? (
            <UserEditor key={current.id} user={current} isMe={current.id === meId} onDone={() => setEditing(null)} />
          ) : (
            <p className="text-muted">Пользователь не найден.</p>
          ))}
      </Modal>
    </section>
  );
}

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
      className="grid gap-4"
    >
      <Field label="Логин" error={fields.login} hint="Латиница, цифры, точка, дефис">
        {(c) => <input {...c} autoComplete="off" value={login} onChange={(e) => setLogin(e.target.value)} className={inputClass} />}
      </Field>
      <Field label="Имя" error={fields.name}>
        {(c) => <input {...c} value={name} onChange={(e) => setName(e.target.value)} className={inputClass} />}
      </Field>
      <Field label="Пароль" error={fields.password} hint="Не короче 10 символов">
        {(c) => <input {...c} type="password" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} className={inputClass} />}
      </Field>
      {create.error && !create.error.fields && (
        <p role="alert" className={`${alertClass} mb-0`}>
          {create.error.message}
        </p>
      )}
      <div className="flex flex-wrap gap-2">
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

function UserEditor({ user, isMe, onDone }: { user: AppUser; isMe: boolean; onDone: () => void }) {
  const [name, setName] = useState(user.name);
  const [password, setPassword] = useState('');
  const [notice, setNotice] = useState<string | null>(null);
  const patch = useMutation<unknown, ApiError, { name?: string; password?: string; disabled?: boolean }>({
    mutationFn: (body) => api(`/users/${user.id}`, { method: 'PATCH', body }),
    onSuccess: async (_data, body) => {
      await invalidateUsers();
      if (body.name !== undefined) return onDone();
      setPassword('');
      if (body.password !== undefined) setNotice('Пароль сброшен, сеансы пользователя завершены');
      else setNotice(body.disabled ? 'Пользователь отключён, его сеансы завершены' : 'Пользователь включён');
    },
  });
  const fields = patch.error?.fields ?? {};
  const run = (body: { name?: string; password?: string; disabled?: boolean }) => {
    setNotice(null);
    patch.mutate(body);
  };

  return (
    <div className="grid gap-6">
      <form
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          run({ name });
        }}
        className="grid gap-4"
      >
        <p className="text-sm text-muted">Логин: {user.login}</p>
        <Field label="Имя" error={fields.name}>
          {(c) => <input {...c} value={name} onChange={(e) => setName(e.target.value)} className={inputClass} />}
        </Field>
        <div className="flex flex-wrap gap-2">
          <button type="submit" disabled={patch.isPending || !name.trim() || name.trim() === user.name} className={btnPrimary}>
            Сохранить
          </button>
          <button type="button" onClick={onDone} className={btnSecondary}>
            Отмена
          </button>
        </div>
      </form>
      {!isMe && (
        <form
          noValidate
          onSubmit={(e) => {
            e.preventDefault();
            run({ password });
          }}
          className="grid gap-3 border-t border-field pt-4"
        >
          <Field label={`Новый пароль для ${user.login}`} error={fields.password} hint="Не короче 10 символов. Сеансы пользователя будут завершены.">
            {(c) => <input {...c} type="password" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} className={inputClass} />}
          </Field>
          <div>
            <button type="submit" disabled={patch.isPending || !password} className={btnSecondary}>
              Сбросить пароль
            </button>
          </div>
        </form>
      )}
      {!isMe && (
        <div className="border-t border-field pt-4">
          <button type="button" disabled={patch.isPending} onClick={() => run({ disabled: !user.disabledAt })} className={user.disabledAt ? btnSecondary : btnDanger}>
            {user.disabledAt ? 'Включить' : 'Отключить'}
          </button>
        </div>
      )}
      {notice && (
        <p role="status" className="text-sm text-muted">
          {notice}
        </p>
      )}
      {patch.error && !patch.error.fields && (
        <p role="alert" className={`${alertClass} mb-0`}>
          {patch.error.message}
        </p>
      )}
    </div>
  );
}
