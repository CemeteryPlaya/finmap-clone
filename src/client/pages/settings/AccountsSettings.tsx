import { useMutation } from '@tanstack/react-query';
import { useState } from 'react';
import { useOutletContext } from 'react-router';
import { getCurrency } from '../../../shared/currencies';
import { formatDateRu } from '../../../shared/dates';
import { formatAmount } from '../../../shared/money';
import { AccountForm, type AccountFormValues } from '../../components/AccountForm';
import { ConfirmDelete } from '../../components/ConfirmDelete';
import { Pending, StaleNotice } from '../../components/QueryState';
import { ReorderButtons } from '../../components/ReorderButtons';
import { alertClass, btnDanger, btnPrimary, btnSecondary, noticeClass } from '../../components/ui';
import { api, type ApiError } from '../../lib/api';
import { moveWithinGroup } from '../../lib/order';
import { queryClient } from '../../lib/query';
import { useAccounts, useProjects, type Account } from '../../lib/queries';
import type { CompanyOutletContext } from '../CompanyLayout';
import { SettingsNav } from './SettingsNav';

type Action = { path: string; method: 'POST' | 'DELETE'; body?: unknown };

function toBody(v: AccountFormValues) {
  return {
    name: v.name,
    currency: v.currency,
    projectId: v.projectId,
    startingBalance: v.startingBalance,
    ...(v.openedAt ? { openedAt: v.openedAt } : {}),
  };
}

export function AccountsSettings() {
  const { company } = useOutletContext<CompanyOutletContext>();
  const accounts = useAccounts(company.id);
  const projects = useProjects(company.id);
  const [creating, setCreating] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [deletingId, setDeletingId] = useState<number | null>(null);
  const readOnly = company.archivedAt !== null;
  const base = `/companies/${company.id}/accounts`;
  const invalidate = () => queryClient.invalidateQueries({ queryKey: ['accounts', company.id] });

  const create = useMutation<unknown, ApiError, AccountFormValues>({
    mutationFn: (v) => api(base, { method: 'POST', body: toBody(v) }),
    onSuccess: async () => {
      await invalidate();
      setCreating(false);
    },
  });
  const update = useMutation<unknown, ApiError, { id: number; values: AccountFormValues }>({
    mutationFn: ({ id, values }) => api(`${base}/${id}`, { method: 'PATCH', body: toBody(values) }),
    onSuccess: async () => {
      await invalidate();
      setEditingId(null);
    },
  });
  const action = useMutation<unknown, ApiError, Action>({
    mutationFn: (a) => api(a.path, { method: a.method, body: a.body }),
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
  const openCreate = () => {
    resetMessages();
    setEditingId(null);
    setDeletingId(null);
    setCreating(true);
  };
  const openEdit = (id: number) => {
    resetMessages();
    setCreating(false);
    setDeletingId(null);
    setEditingId(id);
  };
  const run = (a: Action) => {
    resetMessages();
    action.mutate(a);
  };

  if (!accounts.data || !projects.data) return <Pending queries={[accounts, projects]} />;
  const list = accounts.data;
  const projectList = projects.data;
  const ids = list.map((a) => a.id);
  const groups = [
    { key: 'common', title: 'Общие счета', items: list.filter((a) => a.projectId === null) },
    ...projectList.map((p) => ({
      key: `p${p.id}`,
      title: p.archivedAt ? `${p.name} (в архиве)` : p.name,
      items: list.filter((a) => a.projectId === p.id),
    })),
  ].filter((g) => g.items.length > 0);
  const shift = (group: Account[], id: number, delta: -1 | 1) => {
    const next = moveWithinGroup(
      ids,
      group.map((a) => a.id),
      id,
      delta,
    );
    return next ? () => run({ path: `${base}/reorder`, method: 'POST', body: { ids: next } }) : null;
  };

  return (
    <section>
      <SettingsNav companyId={company.id} />
      <StaleNotice queries={[accounts, projects]} />
      <div className="mb-4 flex items-center justify-between gap-4">
        <h1 className="text-2xl font-bold">Счета</h1>
        {!readOnly && !creating && (
          <button type="button" onClick={openCreate} className={btnPrimary}>
            Добавить счёт
          </button>
        )}
      </div>
      {readOnly && <p className={noticeClass}>Компания в архиве — изменения недоступны.</p>}
      {action.error && (
        <p role="alert" className={alertClass}>
          {action.error.message}
        </p>
      )}
      {creating && (
        <div className="mb-6">
          <AccountForm
            mode="create"
            defaultCurrency={company.baseCurrency}
            projects={projectList}
            pending={create.isPending}
            serverFields={create.error?.fields}
            serverError={create.error && !create.error.fields ? create.error.message : undefined}
            onSubmit={(v) => create.mutate(v)}
            onCancel={() => {
              setCreating(false);
              create.reset();
            }}
          />
        </div>
      )}
      {list.length === 0 && !creating && <p className="text-muted">Счетов пока нет. Счёт — это касса, карта или банковский счёт.</p>}
      {groups.map((g) => (
        <section key={g.key} aria-label={g.title} className="mb-6">
          <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-muted">{g.title}</h2>
          <ul className="space-y-2">
            {g.items.map((a) => {
              const cur = getCurrency(a.currency);
              return (
                <li key={a.id} className={`rounded-2xl border border-field p-4 ${a.archivedAt ? 'opacity-60' : ''}`}>
                  {editingId === a.id ? (
                    <AccountForm
                      mode="edit"
                      initial={a}
                      defaultCurrency={company.baseCurrency}
                      projects={projectList}
                      pending={update.isPending}
                      serverFields={update.error?.fields}
                      serverError={update.error && !update.error.fields ? update.error.message : undefined}
                      onSubmit={(values) => update.mutate({ id: a.id, values })}
                      onCancel={() => {
                        setEditingId(null);
                        update.reset();
                      }}
                    />
                  ) : (
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <div className="min-w-0">
                        <div className="font-semibold">
                          {a.name} <span className="font-normal text-muted">{a.currency}</span>
                          {a.archivedAt && <span className="ml-2 rounded-full bg-field px-2 py-0.5 text-xs text-muted">В архиве</span>}
                        </div>
                        <div className="text-sm text-muted">
                          Остаток на {formatDateRu(a.openedAt)}: {formatAmount(a.startingBalance, cur.minorUnits)} {cur.symbol}
                        </div>
                      </div>
                      {!readOnly &&
                        (deletingId === a.id ? (
                          <ConfirmDelete
                            what={`счёт «${a.name}»`}
                            pending={action.isPending}
                            onConfirm={() => run({ path: `${base}/${a.id}`, method: 'DELETE' })}
                            onCancel={() => setDeletingId(null)}
                          />
                        ) : (
                          <div className="flex flex-wrap items-center gap-2">
                            <ReorderButtons
                              label={a.name}
                              disabled={action.isPending}
                              onUp={shift(g.items, a.id, -1)}
                              onDown={shift(g.items, a.id, 1)}
                            />
                            {!a.archivedAt && (
                              <button type="button" onClick={() => openEdit(a.id)} className={btnSecondary}>
                                Изменить
                              </button>
                            )}
                            <button
                              type="button"
                              onClick={() => run({ path: `${base}/${a.id}/${a.archivedAt ? 'unarchive' : 'archive'}`, method: 'POST' })}
                              className={a.archivedAt ? btnSecondary : btnDanger}
                            >
                              {a.archivedAt ? 'Вернуть из архива' : 'В архив'}
                            </button>
                            <button
                              type="button"
                              onClick={() => {
                                resetMessages();
                                setDeletingId(a.id);
                              }}
                              className={btnSecondary}
                            >
                              Удалить
                            </button>
                          </div>
                        ))}
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        </section>
      ))}
    </section>
  );
}
