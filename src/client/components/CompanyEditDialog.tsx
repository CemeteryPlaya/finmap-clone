import { useMutation } from '@tanstack/react-query';
import { useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router';
import { CURRENCIES } from '../../shared/currencies';
import { api, type ApiError } from '../lib/api';
import { focusHeadingSoon } from '../lib/focus-heading';
import { queryClient } from '../lib/query';
import type { Company } from '../lib/queries';
import { useEntityActions } from '../lib/settings-mutations';
import { useEditedItem, useHeldWhile } from '../lib/use-edited';
import { EntityActions } from './EntityActions';
import { Field } from './Field';
import { Modal } from './Modal';
import { alertClass, btnPrimary, btnSecondary, inputClass } from './ui';

/**
 * Окно «Компания» (✎ в панели «Компании» и на странице «Мои компании», §3.2, §7.4 этапа 1.5): название и базовая
 * валюта, ниже «В архив» / «Вернуть из архива» (решение 9 плана 1.5-1; компании не удаляются). Архивная — только
 * для чтения. Архив открытой компании (currentId) уводит на стартовый экран — он откроет первую активную.
 * Открыто, пока задан editing — id компании из companies (правка по id: свежие данные из списка, R5 плана 1.5-4b).
 */
export function CompanyEditDialog({ companies, editing, currentId, onClose }: { companies: Company[]; editing: number | null; currentId: number; onClose: () => void }) {
  const edited = useEditedItem(companies, editing);
  return (
    <Modal open={editing !== null} title="Компания" onClose={onClose} className="max-w-md">
      {editing !== null && <CompanyEditForm key={editing} company={edited.item} gone={edited.gone} currentId={currentId} onDone={onClose} />}
    </Modal>
  );
}

function CompanyEditForm({ company: fresh, gone, currentId, onDone }: { company: Company | null; gone: boolean; currentId: number; onDone: () => void }) {
  const navigate = useNavigate();
  const [name, setName] = useState(fresh?.name ?? '');
  const [baseCurrency, setBaseCurrency] = useState(fresh?.baseCurrency ?? '');
  const id = fresh?.id ?? 0;
  // ['companies'] обновляет и итоги компаний (['companies', 'summary']); валюта меняет итог в левой панели
  const refresh = () =>
    Promise.all([queryClient.invalidateQueries({ queryKey: ['companies'] }), queryClient.invalidateQueries({ queryKey: ['accounts', id, 'balances'] })]);
  const save = useMutation<unknown, ApiError, Record<string, string>>({
    mutationFn: (changes) => api(`/companies/${id}`, { method: 'PATCH', body: changes }),
    onSuccess: async () => {
      await refresh();
      onDone();
    },
  });
  // «была ли открытой» решают данные отрисовки, в которой нажали «В архив» (замыкание run)
  const actions = useEntityActions(`/companies/${id}`, refresh, () => {
    onDone();
    if (!readOnly && id === currentId) {
      // окно и панель уходят вместе со страницей: фокус — на <h1> страницы, куда приведёт стартовый экран (§11)
      focusHeadingSoon();
      navigate('/', { replace: true });
    }
  });
  // во время своего запроса — компания такой, какой была при нажатии (без вспышки «Вернуть из архива», R5)
  const busy = actions.pending || save.isPending;
  const company = useHeldWhile(fresh, busy);
  const readOnly = (company?.archivedAt ?? null) !== null;
  const fields = save.error?.fields ?? {};

  if ((gone && !busy) || !company) return <p className="text-muted">Компания не найдена.</p>;
  // только изменённые поля: смена валюты может быть запрещена (есть операции), переименование — нет
  const changes = {
    ...(name.trim() !== company.name ? { name: name.trim() } : {}),
    ...(baseCurrency !== company.baseCurrency ? { baseCurrency } : {}),
  };

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    if (Object.keys(changes).length === 0) return onDone();
    save.mutate(changes);
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
        onArchiveToggle={() => {
          // прежняя ошибка «Сохранить» не должна стоять рядом с итогом архива
          save.reset();
          actions.toggleArchive(readOnly);
        }}
        what={`компанию «${company.name}»`}
        pending={actions.pending}
        error={actions.error}
      />
    </>
  );
}
