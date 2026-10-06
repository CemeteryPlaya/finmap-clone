import { useMutation } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { useOutletContext } from 'react-router';
import { COUNTERPARTY_TYPE_LABELS, COUNTERPARTY_TYPE_SINGULAR, COUNTERPARTY_TYPES } from '../../../shared/counterparties';
import { matchesQuery } from '../../../shared/search';
import type { CounterpartyType } from '../../../shared/system-categories';
import { ConfirmDelete } from '../../components/ConfirmDelete';
import { Field } from '../../components/Field';
import { Pending, StaleNotice } from '../../components/QueryState';
import { alertClass, btnPrimary, btnSecondary, btnSmall, inputClass, noticeClass } from '../../components/ui';
import { api, type ApiError } from '../../lib/api';
import { queryClient } from '../../lib/query';
import { useCounterparties } from '../../lib/queries';
import type { CompanyOutletContext } from '../CompanyLayout';
import { SettingsNav } from './SettingsNav';

type Tab = 'all' | CounterpartyType;
type Action = { path: string; method: 'POST' | 'DELETE' };

interface Draft {
  type: CounterpartyType;
  name: string;
  comment: string;
}

function CounterpartyForm(props: {
  initial: Draft;
  submitLabel: string;
  pending: boolean;
  fields?: Record<string, string>;
  onSubmit: (draft: Draft) => void;
  onCancel?: () => void;
}) {
  const [draft, setDraft] = useState(props.initial);
  // смена вкладки подставляет тип, пока пользователь не начал вводить название; набранный черновик не теряется
  const initialType = props.initial.type;
  useEffect(() => {
    setDraft((d) => (d.name === '' && d.type !== initialType ? { ...d, type: initialType } : d));
  }, [initialType]);
  const fields = props.fields ?? {};
  return (
    <form
      noValidate
      onSubmit={(e) => {
        e.preventDefault();
        props.onSubmit(draft);
      }}
      className="grid gap-3 rounded-2xl bg-canvas p-4 md:grid-cols-[12rem_1fr_1fr_auto] md:items-start"
    >
      <Field label="Тип" error={fields.type}>
        {(c) => (
          <select {...c} value={draft.type} onChange={(e) => setDraft({ ...draft, type: e.target.value as CounterpartyType })} className={inputClass}>
            {COUNTERPARTY_TYPES.map((t) => (
              <option key={t} value={t}>
                {COUNTERPARTY_TYPE_SINGULAR[t]}
              </option>
            ))}
          </select>
        )}
      </Field>
      <Field label="Название контрагента" error={fields.name}>
        {(c) => <input {...c} value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} className={inputClass} />}
      </Field>
      <Field label="Комментарий" error={fields.comment}>
        {(c) => <input {...c} value={draft.comment} onChange={(e) => setDraft({ ...draft, comment: e.target.value })} className={inputClass} />}
      </Field>
      <div className="flex gap-2 md:mt-6">
        <button type="submit" disabled={props.pending || !draft.name.trim()} className={btnPrimary}>
          {props.submitLabel}
        </button>
        {props.onCancel && (
          <button type="button" onClick={props.onCancel} className={btnSecondary}>
            Отмена
          </button>
        )}
      </div>
    </form>
  );
}

export function CounterpartiesSettings() {
  const { company } = useOutletContext<CompanyOutletContext>();
  const counterparties = useCounterparties(company.id);
  const [tab, setTab] = useState<Tab>('all');
  const [query, setQuery] = useState('');
  const [createKey, setCreateKey] = useState(0);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [deletingId, setDeletingId] = useState<number | null>(null);
  const readOnly = company.archivedAt !== null;
  const base = `/companies/${company.id}/counterparties`;
  const invalidate = () => queryClient.invalidateQueries({ queryKey: ['counterparties', company.id] });
  const toBody = (d: Draft) => ({ type: d.type, name: d.name, comment: d.comment });

  const create = useMutation<unknown, ApiError, Draft>({
    mutationFn: (d) => api(base, { method: 'POST', body: toBody(d) }),
    onSuccess: async () => {
      await invalidate();
      setCreateKey((k) => k + 1); // пустая форма для следующего контрагента
    },
  });
  const update = useMutation<unknown, ApiError, { id: number; draft: Draft }>({
    mutationFn: ({ id, draft }) => api(`${base}/${id}`, { method: 'PATCH', body: toBody(draft) }),
    onSuccess: async () => {
      await invalidate();
      setEditingId(null);
    },
  });
  const action = useMutation<unknown, ApiError, Action>({
    mutationFn: (a) => api(a.path, { method: a.method }),
    onSuccess: async () => {
      setDeletingId(null);
      await invalidate();
    },
  });
  const resetMessages = () => {
    create.reset();
    update.reset();
    action.reset();
  };

  if (!counterparties.data) return <Pending queries={[counterparties]} />;
  const all = counterparties.data;
  const visible = all
    .filter((c) => (tab === 'all' || c.type === tab) && matchesQuery(`${c.name} ${c.comment ?? ''}`, query))
    .sort((a, b) => Number(a.archivedAt !== null) - Number(b.archivedAt !== null));
  const error = action.error ?? (create.error && !create.error.fields ? create.error : null) ?? (update.error && !update.error.fields ? update.error : null);
  const tabs: Tab[] = ['all', ...COUNTERPARTY_TYPES];

  return (
    <section>
      <SettingsNav companyId={company.id} />
      <StaleNotice queries={[counterparties]} />
      <h1 className="mb-4 text-2xl font-bold">Контрагенты</h1>
      {readOnly && <p className={noticeClass}>Компания в архиве — изменения недоступны.</p>}
      {error && (
        <p role="alert" className={alertClass}>
          {error.message}
        </p>
      )}
      {!readOnly && (
        <div className="mb-6">
          <CounterpartyForm
            key={createKey}
            initial={{ type: tab === 'all' ? 'client' : tab, name: '', comment: '' }}
            submitLabel="Добавить"
            pending={create.isPending}
            fields={create.error?.fields}
            onSubmit={(d) => {
              resetMessages();
              create.mutate(d);
            }}
          />
        </div>
      )}
      <div role="tablist" aria-label="Типы контрагентов" className="mb-4 flex flex-wrap gap-2">
        {tabs.map((t) => (
          <button
            key={t}
            type="button"
            role="tab"
            aria-selected={tab === t}
            aria-controls="counterparties-panel"
            onClick={() => setTab(t)}
            className={`rounded-xl px-3 py-1.5 text-sm ${tab === t ? 'bg-ink font-semibold text-white' : 'bg-field text-ink hover:brightness-95'}`}
          >
            {t === 'all' ? 'Все' : COUNTERPARTY_TYPE_LABELS[t]}{' '}
            <span className={tab === t ? 'text-white/70' : 'text-muted'}>{t === 'all' ? all.length : all.filter((c) => c.type === t).length}</span>
          </button>
        ))}
      </div>
      <Field label="Поиск" className="mb-4 block max-w-md">
        {(c) => <input {...c} type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Имя или комментарий" className={inputClass} />}
      </Field>
      <div id="counterparties-panel" role="tabpanel">
        {visible.length === 0 && <p className="text-muted">{all.length === 0 ? 'Контрагентов пока нет.' : 'Ничего не найдено.'}</p>}
        <ul className="space-y-2">
          {visible.map((c) => (
            <li key={c.id} className={`rounded-2xl border border-field p-4 ${c.archivedAt ? 'opacity-60' : ''}`}>
              {editingId === c.id ? (
                <CounterpartyForm
                  initial={{ type: c.type, name: c.name, comment: c.comment ?? '' }}
                  submitLabel="Сохранить"
                  pending={update.isPending}
                  fields={update.error?.fields}
                  onSubmit={(draft) => update.mutate({ id: c.id, draft })}
                  onCancel={() => {
                    setEditingId(null);
                    update.reset();
                  }}
                />
              ) : (
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div className="min-w-0">
                    <div className="font-semibold">
                      {c.name}
                      {c.archivedAt && <span className="ml-2 rounded-full bg-field px-2 py-0.5 text-xs text-muted">В архиве</span>}
                    </div>
                    <div className="text-sm text-muted">
                      {COUNTERPARTY_TYPE_SINGULAR[c.type]}
                      {c.comment ? ` · ${c.comment}` : ''}
                    </div>
                  </div>
                  {!readOnly &&
                    (deletingId === c.id ? (
                      <ConfirmDelete
                        what={`контрагента «${c.name}»`}
                        pending={action.isPending}
                        onConfirm={() => action.mutate({ path: `${base}/${c.id}`, method: 'DELETE' })}
                        onCancel={() => setDeletingId(null)}
                      />
                    ) : (
                      <div className="flex flex-wrap gap-2">
                        {!c.archivedAt && (
                          <button
                            type="button"
                            onClick={() => {
                              resetMessages();
                              setDeletingId(null);
                              setEditingId(c.id);
                            }}
                            className={btnSmall}
                          >
                            Изменить
                          </button>
                        )}
                        <button
                          type="button"
                          onClick={() => {
                            resetMessages();
                            action.mutate({ path: `${base}/${c.id}/${c.archivedAt ? 'unarchive' : 'archive'}`, method: 'POST' });
                          }}
                          className={btnSmall}
                        >
                          {c.archivedAt ? 'Вернуть из архива' : 'В архив'}
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            resetMessages();
                            setDeletingId(c.id);
                          }}
                          className={btnSmall}
                        >
                          Удалить
                        </button>
                      </div>
                    ))}
                </div>
              )}
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
