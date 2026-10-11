import { useMutation } from '@tanstack/react-query';
import { useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router';
import { CURRENCIES } from '../../shared/currencies';
import { api, type ApiError } from '../lib/api';
import { queryClient } from '../lib/query';
import type { Company } from '../lib/queries';
import { useEntityActions } from '../lib/settings-mutations';
import { EntityActions } from './EntityActions';
import { Field } from './Field';
import { Modal } from './Modal';
import { alertClass, btnPrimary, btnSecondary, inputClass } from './ui';

/**
 * Окно «Компания» (✎ в панели «Компании» и на странице «Мои компании», §3.2, §7.4 этапа 1.5): название и базовая
 * валюта, ниже «В архив» / «Вернуть из архива» (решение 9 плана 1.5-1; компании не удаляются). Архивная — только
 * для чтения. Архив открытой компании (currentId) уводит на стартовый экран — он откроет первую активную.
 * Открыто, пока задана company.
 */
export function CompanyEditDialog({ company, currentId, onClose }: { company: Company | null; currentId: number; onClose: () => void }) {
  return (
    <Modal open={company !== null} title="Компания" onClose={onClose} className="max-w-md">
      {company && <CompanyEditForm key={company.id} company={company} currentId={currentId} onDone={onClose} />}
    </Modal>
  );
}

function CompanyEditForm({ company, currentId, onDone }: { company: Company; currentId: number; onDone: () => void }) {
  const navigate = useNavigate();
  const [name, setName] = useState(company.name);
  const [baseCurrency, setBaseCurrency] = useState(company.baseCurrency);
  const readOnly = company.archivedAt !== null;
  // ['companies'] обновляет и итоги компаний (['companies', 'summary']); валюта меняет итог в левой панели
  const refresh = () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: ['companies'] }),
      queryClient.invalidateQueries({ queryKey: ['accounts', company.id, 'balances'] }),
    ]);
  // только изменённые поля: смена валюты может быть запрещена (есть операции), переименование — нет
  const changes = {
    ...(name.trim() !== company.name ? { name: name.trim() } : {}),
    ...(baseCurrency !== company.baseCurrency ? { baseCurrency } : {}),
  };
  const save = useMutation<unknown, ApiError>({
    mutationFn: () => api(`/companies/${company.id}`, { method: 'PATCH', body: changes }),
    onSuccess: async () => {
      await refresh();
      onDone();
    },
  });
  const actions = useEntityActions(`/companies/${company.id}`, refresh, () => {
    onDone();
    if (!readOnly && company.id === currentId) navigate('/', { replace: true });
  });
  const fields = save.error?.fields ?? {};

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    if (Object.keys(changes).length === 0) return onDone();
    save.mutate();
  };

  return (
    <>
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
      <EntityActions
        archived={readOnly}
        onArchiveToggle={() => actions.toggleArchive(readOnly)}
        what={`компанию «${company.name}»`}
        pending={actions.pending}
        error={actions.error}
      />
    </>
  );
}
