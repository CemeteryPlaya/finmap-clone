import { useMutation } from '@tanstack/react-query';
import { useState, type FormEvent } from 'react';
import { CURRENCIES } from '../../shared/currencies';
import { api, ApiError } from '../lib/api';
import { queryClient } from '../lib/query';
import type { Company } from '../lib/queries';
import { btnPrimary, inputClass } from './ui';

export function CompanyForm({ onCreated }: { onCreated: (c: Company) => void }) {
  const [name, setName] = useState('');
  const [baseCurrency, setBaseCurrency] = useState('KZT');
  const create = useMutation<{ company: Company }, ApiError>({
    mutationFn: () => api('/companies', { method: 'POST', body: { name, baseCurrency } }),
    onSuccess: async ({ company }) => {
      await queryClient.invalidateQueries({ queryKey: ['companies'] });
      onCreated(company);
    },
  });
  const fields = create.error?.fields ?? {};

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    create.mutate();
  };

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      <label className="block">
        <span className="mb-1 block text-sm text-muted">Название компании</span>
        <input autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="ТОО «Ромашка»" className={inputClass} />
        {fields.name && <span className="mt-1 block text-sm text-expense">{fields.name}</span>}
      </label>
      <label className="block">
        <span className="mb-1 block text-sm text-muted">Базовая валюта</span>
        <select value={baseCurrency} onChange={(e) => setBaseCurrency(e.target.value)} className={inputClass}>
          {CURRENCIES.map((c) => (
            <option key={c.code} value={c.code}>
              {c.code} — {c.name}
            </option>
          ))}
        </select>
        {fields.baseCurrency && <span className="mt-1 block text-sm text-expense">{fields.baseCurrency}</span>}
      </label>
      {create.error && !create.error.fields && (
        <p role="alert" className="rounded-xl bg-expense-soft px-4 py-3 text-sm text-expense">
          {create.error.message}
        </p>
      )}
      <button type="submit" disabled={create.isPending || !name.trim()} className={btnPrimary}>
        {create.isPending ? 'Создаём…' : 'Создать компанию'}
      </button>
    </form>
  );
}
