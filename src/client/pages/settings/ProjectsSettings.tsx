import { useMutation } from '@tanstack/react-query';
import { useState } from 'react';
import { useOutletContext } from 'react-router';
import { ConfirmDelete } from '../../components/ConfirmDelete';
import { ProjectForm, type ProjectFormValues } from '../../components/ProjectForm';
import { Pending, StaleNotice } from '../../components/QueryState';
import { ReorderButtons } from '../../components/ReorderButtons';
import { alertClass, btnDanger, btnPrimary, btnSecondary, noticeClass } from '../../components/ui';
import { api, type ApiError } from '../../lib/api';
import { moveWithinGroup } from '../../lib/order';
import { queryClient } from '../../lib/query';
import { useProjects, useTemplates, type Project, type TemplateInfo } from '../../lib/queries';
import type { CompanyOutletContext } from '../CompanyLayout';
import { ProjectsTabs } from './ProjectsTabs';

type Action = { path: string; method: 'POST' | 'DELETE'; body?: unknown };

function paramsSummary(p: Project, t: TemplateInfo | undefined): string {
  return (t?.paramsUi ?? []).map((u) => `${u.label}: ${String(p.templateParams[u.key] ?? '—')}`).join(', ');
}

export function ProjectsSettings() {
  const { company } = useOutletContext<CompanyOutletContext>();
  const projects = useProjects(company.id);
  const templates = useTemplates();
  const [creating, setCreating] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [deletingId, setDeletingId] = useState<number | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const readOnly = company.archivedAt !== null;
  const base = `/companies/${company.id}/projects`;
  const invalidate = () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: ['projects', company.id] }),
      queryClient.invalidateQueries({ queryKey: ['accounts', company.id] }),
      queryClient.invalidateQueries({ queryKey: ['categories', company.id] }),
    ]);

  const create = useMutation<unknown, ApiError, ProjectFormValues>({
    mutationFn: (v) => api(base, { method: 'POST', body: { name: v.name, templateKey: v.templateKey, templateParams: v.templateParams } }),
    onSuccess: async () => {
      await invalidate();
      setCreating(false);
    },
  });
  const update = useMutation<{ renamedAccounts: number }, ApiError, { id: number; values: ProjectFormValues }>({
    mutationFn: ({ id, values }) =>
      api(`${base}/${id}`, {
        method: 'PATCH',
        body: {
          name: values.name,
          templateParams: values.templateParams,
          ...(values.renameAccounts !== undefined ? { renameAccounts: values.renameAccounts } : {}),
        },
      }),
    onSuccess: async (res) => {
      await invalidate();
      setEditingId(null);
      if (res.renamedAccounts > 0) setNotice(`Переименовано счетов: ${res.renamedAccounts}`);
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
    setNotice(null);
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

  if (!projects.data || !templates.data) return <Pending queries={[projects, templates]} />;
  const list = projects.data;
  const templateList = templates.data;
  const ids = list.map((p) => p.id);
  const tpl = (key: string) => templateList.find((t) => t.key === key);
  const shift = (id: number, delta: -1 | 1) => {
    const next = moveWithinGroup(ids, ids, id, delta);
    return next ? () => run({ path: `${base}/reorder`, method: 'POST', body: { ids: next } }) : null;
  };

  return (
    <section>
      <ProjectsTabs companyId={company.id} />
      <StaleNotice queries={[projects, templates]} />
      <div className="mb-4 flex items-center justify-between gap-4">
        <h1 className="text-2xl font-bold">Проекты</h1>
        {!readOnly && !creating && (
          <button type="button" onClick={openCreate} className={btnPrimary}>
            Добавить проект
          </button>
        )}
      </div>
      {readOnly && <p className={noticeClass}>Компания в архиве — изменения недоступны.</p>}
      {notice && (
        <p role="status" className={noticeClass}>
          {notice}
        </p>
      )}
      {action.error && (
        <p role="alert" className={alertClass}>
          {action.error.message}
        </p>
      )}
      {creating && (
        <div className="mb-6">
          <ProjectForm
            templates={templateList}
            mode="create"
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
      {list.length === 0 && !creating && <p className="text-muted">Проектов пока нет. Проект — это клуб, магазин или офис внутри компании.</p>}
      <ul className="space-y-2">
        {list.map((p) => (
          <li key={p.id} className={`rounded-2xl border border-field p-4 ${p.archivedAt ? 'opacity-60' : ''}`}>
            {editingId === p.id ? (
              <ProjectForm
                templates={templateList}
                mode="edit"
                initial={{ name: p.name, templateKey: p.templateKey, templateParams: p.templateParams }}
                pending={update.isPending}
                serverFields={update.error?.fields}
                serverError={update.error && !update.error.fields ? update.error.message : undefined}
                onSubmit={(values) => update.mutate({ id: p.id, values })}
                onCancel={() => {
                  setEditingId(null);
                  update.reset();
                }}
              />
            ) : (
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="min-w-0">
                  <div className="font-semibold">
                    {p.name}
                    {p.archivedAt && <span className="ml-2 rounded-full bg-field px-2 py-0.5 text-xs text-muted">В архиве</span>}
                  </div>
                  <div className="text-sm text-muted">
                    {tpl(p.templateKey)?.name ?? p.templateKey}
                    {paramsSummary(p, tpl(p.templateKey)) && ` · ${paramsSummary(p, tpl(p.templateKey))}`}
                  </div>
                </div>
                {!readOnly &&
                  (deletingId === p.id ? (
                    <ConfirmDelete
                      what={`проект «${p.name}»`}
                      pending={action.isPending}
                      onConfirm={() => run({ path: `${base}/${p.id}`, method: 'DELETE' })}
                      onCancel={() => setDeletingId(null)}
                    />
                  ) : (
                    <div className="flex flex-wrap items-center gap-2">
                      <ReorderButtons label={p.name} disabled={action.isPending} onUp={shift(p.id, -1)} onDown={shift(p.id, 1)} />
                      {!p.archivedAt && (
                        <button type="button" onClick={() => openEdit(p.id)} className={btnSecondary}>
                          Изменить
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={() => run({ path: `${base}/${p.id}/${p.archivedAt ? 'unarchive' : 'archive'}`, method: 'POST' })}
                        className={p.archivedAt ? btnSecondary : btnDanger}
                      >
                        {p.archivedAt ? 'Вернуть из архива' : 'В архив'}
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          resetMessages();
                          setDeletingId(p.id);
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
        ))}
      </ul>
    </section>
  );
}
