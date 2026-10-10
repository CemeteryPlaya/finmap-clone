import { useMutation } from '@tanstack/react-query';
import { useState, type FormEvent } from 'react';
import { CURRENCIES } from '../../shared/currencies';
import { api, type ApiError } from '../lib/api';
import { queryClient } from '../lib/query';
import type { Company } from '../lib/queries';
import { Field } from './Field';
import { Modal } from './Modal';
import { alertClass, btnPrimary, btnSecondary, inputClass } from './ui';

/**
 * Окно «Компания» (✎ в панели «Компании», §3.2 этапа 1.5): название и базовая валюта. Открыто, пока задана
 * company. «В архив» и «Вернуть из архива» появятся здесь в плане 1.5-4, пока — на странице «Мои компании».
 */
export function CompanyEditDialog({ company, onClose }: { company: Company | null; onClose: () => void }) {
  return (
    <Modal open={company !== null} title="Компания" onClose={onClose} className="max-w-md">
      {company && <CompanyEditForm key={company.id} company={company} onDone={onClose} />}
    </Modal>
  );
}

function CompanyEditForm({ company, onDone }: { company: Company; onDone: () => void }) {
  const [name, setName] = useState(company.name);
  const [baseCurrency, setBaseCurrency] = useState(company.baseCurrency);
  const readOnly = company.archivedAt !== null;
  // только изменённые поля: смена валюты может быть запрещена (есть операции), переименование — нет
  const changes = {
    ...(name.trim() !== company.name ? { name } : {}),
    ...(baseCurrency !== company.baseCurrency ? { baseCurrency } : {}),
  };
  const save = useMutation<unknown, ApiError>({
    mutationFn: () => api(`/companies/${company.id}`, { method: 'PATCH', body: changes }),
    onSuccess: async () => {
      // ['companies'] обновляет и итоги компаний (['companies', 'summary']); валюта меняет итог в левой панели
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['companies'] }),
        queryClient.invalidateQueries({ queryKey: ['accounts', company.id, 'balances'] }),
      ]);
      onDone();
    },
  });
  const fields = save.error?.fields ?? {};

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    if (Object.keys(changes).length === 0) return onDone();
    save.mutate();
  };

  return (
    <form onSubmit={onSubmit} noValidate className="grid gap-4">
      <Field label="Название компании" error={fields.name}>
        {(c) => <input {...c} value={name} disabled={readOnly || save.isPending} onChange={(e) => setName(e.target.value)} className={inputClass} />}
      </Field>
      <Field
        label="Базовая валюта"
        error={fields.baseCurrency}
        hint={company.currencyLocked ? 'В компании есть операции или фиксированные курсы — базовую валюту изменить нельзя' : undefined}
      >
        {(c) => (
          <select
            {...c}
            value={baseCurrency}
            disabled={readOnly || company.currencyLocked || save.isPending}
            onChange={(e) => setBaseCurrency(e.target.value)}
            className={inputClass}
          >
            {CURRENCIES.map((x) => (
              <option key={x.code} value={x.code}>
                {x.code} — {x.name}
              </option>
            ))}
          </select>
        )}
      </Field>
      {save.error && !save.error.fields && (
        <p role="alert" className={`${alertClass} mb-0`}>
          {save.error.message}
        </p>
      )}
      <div className="flex flex-wrap gap-2">
        {!readOnly && (
          <button type="submit" disabled={save.isPending || !name.trim()} className={btnPrimary}>
            Сохранить
          </button>
        )}
        <button type="button" onClick={onDone} className={btnSecondary}>
          Отмена
        </button>
      </div>
    </form>
  );
}
