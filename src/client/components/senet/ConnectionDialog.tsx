import { useMutation } from '@tanstack/react-query';
import { useState, type FormEvent } from 'react';
import { formatDateTime } from '../../../shared/dates';
import type { SenetCheckResult, SenetConnectionDto } from '../../../shared/schemas/senet';
import { api, type ApiError } from '../../lib/api';
import { connectionKey, invalidateSenet, orgFromInput, senetAddress, type ConnectionForm } from '../../lib/senet';
import { Field } from '../Field';
import { alertClass, btnPrimary, btnSecondary, inputClass, noticeClass } from '../ui';

const TOKEN_HINT = 'Админ-панель Senet → F12 → Application → Local Storage → значение токена входа. Токен живёт до выхода из админ-панели или смены пароля';

/**
 * Окно подключения Senet (§8.1): адрес организации, способ входа, «Проверить». Сохранить можно только проверенные
 * данные: любая правка формы после проверки требует новой проверки. У существующего подключения — замена данных входа.
 */
export function ConnectionDialog(props: { companyId: number; timeZone: string; connection: SenetConnectionDto | null; onDone: () => void }) {
  const existing = props.connection;
  const [name, setName] = useState(existing?.name ?? 'Клубы');
  const [orgText, setOrgText] = useState(existing?.org ?? '');
  const [form, setForm] = useState<Omit<ConnectionForm, 'org'>>({ authMethod: 'password', username: '', password: '', token: '', officeId: 1, cashDeskId: 1 });
  const [checked, setChecked] = useState<{ key: string; result: SenetCheckResult } | null>(null);
  const org = orgFromInput(orgText);
  const full: ConnectionForm | null = org ? { ...form, org } : null;
  const key = full ? connectionKey(full) : null;
  const set = (patch: Partial<typeof form>) => setForm((f) => ({ ...f, ...patch }));

  const check = useMutation<SenetCheckResult, ApiError>({
    mutationFn: () => api(`/companies/${props.companyId}/senet/connections/check`, { method: 'POST', body: full }),
    onSuccess: (result) => setChecked({ key: key!, result }),
  });
  const save = useMutation<unknown, ApiError>({
    mutationFn: async () => {
      const credentials = { authMethod: form.authMethod, username: form.username, password: form.password, token: form.token };
      if (existing) return api(`/companies/${props.companyId}/senet/connections/${existing.id}`, { method: 'PATCH', body: { name, credentials } });
      const created = await api<{ connection: SenetConnectionDto }>(`/companies/${props.companyId}/senet/connections`, {
        method: 'POST',
        body: { name, org, ...credentials },
      });
      // клуб, на котором проверяли, добавляется сразу — выключенным: связи владелец заполнит в форме клуба
      return api(`/companies/${props.companyId}/senet/connections/${created.connection.id}/offices`, {
        method: 'POST',
        body: { senetOfficeId: form.officeId, cashDeskId: form.cashDeskId, name: checked?.result.officeName ?? '', enabled: false },
      });
    },
    onSuccess: async () => {
      await invalidateSenet(props.companyId);
      props.onDone();
    },
  });
  const verified = checked !== null && checked.key === key;
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (verified) save.mutate();
  };
  const fieldError = (f: string) => check.error?.fields?.[f] ?? save.error?.fields?.[f];

  return (
    <form noValidate onSubmit={submit} className="grid gap-4">
      <Field label="Название" error={fieldError('name')}>
        {(c) => <input {...c} value={name} maxLength={100} onChange={(e) => setName(e.target.value)} className={inputClass} />}
      </Field>
      <Field label="Адрес организации" hint={org ? senetAddress(org) : 'Имя или ссылка на админ-панель: https://имя.admin-v2.enes.tech/'} error={fieldError('org')}>
        {(c) => <input {...c} value={orgText} readOnly={existing !== null} onChange={(e) => setOrgText(e.target.value)} autoComplete="off" className={inputClass} />}
      </Field>
      <fieldset className="grid gap-2">
        <legend className="mb-1 text-sm font-semibold">Способ входа</legend>
        <label className="flex items-start gap-2">
          <input type="radio" name="authMethod" checked={form.authMethod === 'password'} onChange={() => set({ authMethod: 'password' })} className="mt-1" />
          <span>
            Логин и пароль Senet
            <span className="block text-sm text-muted">Рекомендуется отдельный пользователь только для отчётов</span>
          </span>
        </label>
        <label className="flex items-start gap-2">
          <input type="radio" name="authMethod" checked={form.authMethod === 'token'} onChange={() => set({ authMethod: 'token' })} className="mt-1" />
          <span>
            Токен
            <span className="block text-sm text-muted">Если Senet просит код подтверждения или вход через SSO</span>
          </span>
        </label>
      </fieldset>
      {form.authMethod === 'password' ? (
        <>
          <Field label="Логин пользователя Senet" error={fieldError('username')}>
            {(c) => <input {...c} value={form.username} autoComplete="off" onChange={(e) => set({ username: e.target.value })} className={inputClass} />}
          </Field>
          <Field label="Пароль" error={fieldError('password')}>
            {(c) => <input {...c} type="password" value={form.password} autoComplete="new-password" onChange={(e) => set({ password: e.target.value })} className={inputClass} />}
          </Field>
        </>
      ) : (
        <Field label="Токен" hint={TOKEN_HINT} error={fieldError('token')}>
          {(c) => <input {...c} type="password" value={form.token} autoComplete="off" onChange={(e) => set({ token: e.target.value })} className={inputClass} />}
        </Field>
      )}
      <div className="grid grid-cols-2 gap-3">
        <Field label="Номер клуба Senet" hint="office_id, обычно 1">
          {(c) => <input {...c} type="number" min={1} value={form.officeId} onChange={(e) => set({ officeId: Number(e.target.value) || 1 })} className={inputClass} />}
        </Field>
        <Field label="Номер кассы">
          {(c) => <input {...c} type="number" min={1} value={form.cashDeskId} onChange={(e) => set({ cashDeskId: Number(e.target.value) || 1 })} className={inputClass} />}
        </Field>
      </div>
      {check.error && !check.error.fields && (
        <p role="alert" className={`${alertClass} mb-0`}>
          {check.error.message}
        </p>
      )}
      {verified && (
        <p role="status" className={`${noticeClass} mb-0`}>
          {checked.result.officeName ? `Клуб «${checked.result.officeName}»: ` : ''}смен за сутки — {checked.result.shifts}
          {checked.result.lastClosedAt ? `, последняя закрыта ${formatDateTime(checked.result.lastClosedAt, props.timeZone)}` : ''}
        </p>
      )}
      {save.error && !save.error.fields && (
        <p role="alert" className={`${alertClass} mb-0`}>
          {save.error.message}
        </p>
      )}
      <div className="flex flex-wrap gap-2">
        <button type="button" onClick={() => check.mutate()} disabled={!full || check.isPending} className={btnSecondary}>
          {check.isPending ? 'Проверяем…' : 'Проверить'}
        </button>
        <button type="submit" disabled={!verified || save.isPending} className={btnPrimary} title={verified ? undefined : 'Сначала проверьте подключение'}>
          Сохранить
        </button>
        <button type="button" onClick={props.onDone} className={btnSecondary}>
          Отмена
        </button>
      </div>
    </form>
  );
}
