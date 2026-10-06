import { useMutation } from '@tanstack/react-query';
import { useState } from 'react';
import { Link, useNavigate, useOutletContext } from 'react-router';
import { CURRENCIES } from '../../../shared/currencies';
import { btnDanger, btnPrimary, btnSecondary, inputClass } from '../../components/ui';
import { api, type ApiError } from '../../lib/api';
import { queryClient } from '../../lib/query';
import { useCompanies, type Company } from '../../lib/queries';
import type { CompanyOutletContext } from '../CompanyLayout';
import { SettingsNav } from './SettingsNav';

function CompanyRow({ c, currentId }: { c: Company; currentId: number }) {
  const navigate = useNavigate();
  const [name, setName] = useState(c.name);
  const [baseCurrency, setBaseCurrency] = useState(c.baseCurrency);
  const dirty = name.trim() !== c.name || baseCurrency !== c.baseCurrency;
  const invalidate = () => queryClient.invalidateQueries({ queryKey: ['companies'] });

  const save = useMutation<unknown, ApiError>({
    // отправляем только изменённые поля: позже смена валюты блокируется при наличии операций, переименование — нет
    mutationFn: () =>
      api(`/companies/${c.id}`, {
        method: 'PATCH',
        body: {
          ...(name.trim() !== c.name ? { name } : {}),
          ...(baseCurrency !== c.baseCurrency ? { baseCurrency } : {}),
        },
      }),
    onSuccess: invalidate,
  });
  const toggle = useMutation<unknown, ApiError>({
    mutationFn: () => api(`/companies/${c.id}/${c.archivedAt ? 'unarchive' : 'archive'}`, { method: 'POST' }),
    onSuccess: async () => {
      await invalidate();
      if (!c.archivedAt && c.id === currentId) navigate('/', { replace: true });
    },
  });
  const error = save.error ?? toggle.error;
  const readOnly = c.archivedAt !== null;

  return (
    <li className={`rounded-2xl border border-field p-4 ${readOnly ? 'opacity-70' : ''}`}>
      <div className="grid gap-3 md:grid-cols-[1fr_12rem_auto] md:items-end">
        <label className="block">
          <span className="mb-1 block text-sm text-muted">Название</span>
          <input value={name} disabled={readOnly} onChange={(e) => setName(e.target.value)} className={inputClass} />
        </label>
        <label className="block">
          <span className="mb-1 block text-sm text-muted">Базовая валюта</span>
          <select value={baseCurrency} disabled={readOnly} onChange={(e) => setBaseCurrency(e.target.value)} className={inputClass}>
            {CURRENCIES.map((x) => (
              <option key={x.code} value={x.code}>
                {x.code}
              </option>
            ))}
          </select>
        </label>
        <div className="flex gap-2">
          {!readOnly && (
            <button type="button" disabled={!dirty || save.isPending} onClick={() => save.mutate()} className={btnPrimary}>
              Сохранить
            </button>
          )}
          <button type="button" onClick={() => toggle.mutate()} className={readOnly ? btnSecondary : btnDanger}>
            {readOnly ? 'Вернуть из архива' : 'В архив'}
          </button>
        </div>
      </div>
      {readOnly && <p className="mt-2 text-sm text-muted">В архиве</p>}
      {error && (
        <p role="alert" className="mt-2 rounded-xl bg-expense-soft px-4 py-2 text-sm text-expense">
          {error.fields ? Object.values(error.fields).join('. ') : error.message}
        </p>
      )}
    </li>
  );
}

export function CompaniesSettings() {
  const { company } = useOutletContext<CompanyOutletContext>();
  const companies = useCompanies();
  if (companies.isPending) return <div className="text-muted">Загрузка…</div>;
  if (companies.error) return <div className="text-expense">{companies.error.message}</div>;
  return (
    <section>
      <SettingsNav companyId={company.id} />
      <div className="mb-4 flex items-center justify-between gap-4">
        <h1 className="text-2xl font-bold">Компании</h1>
        <Link to="/companies/new" className={btnPrimary}>
          Добавить компанию
        </Link>
      </div>
      <ul className="space-y-2">
        {companies.data.map((c) => (
          <CompanyRow key={`${c.id}-${c.name}-${c.baseCurrency}-${c.archivedAt}`} c={c} currentId={company.id} />
        ))}
      </ul>
    </section>
  );
}
