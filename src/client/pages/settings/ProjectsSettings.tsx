import { useMutation } from '@tanstack/react-query';
import { useState } from 'react';
import { useOutletContext } from 'react-router';
import { ProjectForm, type ProjectFormValues } from '../../components/ProjectForm';
import { btnDanger, btnPrimary, btnSecondary } from '../../components/ui';
import { api, type ApiError } from '../../lib/api';
import { queryClient } from '../../lib/query';
import { useProjects, useTemplates, type Project, type TemplateInfo } from '../../lib/queries';
import type { CompanyOutletContext } from '../CompanyLayout';
import { SettingsNav } from './SettingsNav';

function paramsSummary(p: Project, t: TemplateInfo | undefined): string {
  return (t?.paramsUi ?? []).map((u) => `${u.label}: ${String(p.templateParams[u.key] ?? '—')}`).join(', ');
}

export function ProjectsSettings() {
  const { company } = useOutletContext<CompanyOutletContext>();
  const projects = useProjects(company.id);
  const templates = useTemplates();
  const [creating, setCreating] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const readOnly = company.archivedAt !== null;
  const invalidate = () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: ['projects', company.id] }),
      queryClient.invalidateQueries({ queryKey: ['accounts', company.id] }),
      queryClient.invalidateQueries({ queryKey: ['categories', company.id] }),
    ]);

  const create = useMutation<unknown, ApiError, ProjectFormValues>({
    mutationFn: (v) => api(`/companies/${company.id}/projects`, { method: 'POST', body: v }),
    onSuccess: async () => {
      await invalidate();
      setCreating(false);
    },
  });
  const update = useMutation<unknown, ApiError, { id: number; values: ProjectFormValues }>({
    mutationFn: ({ id, values }) =>
      api(`/companies/${company.id}/projects/${id}`, { method: 'PATCH', body: { name: values.name, templateParams: values.templateParams } }),
    onSuccess: async () => {
      await invalidate();
      setEditingId(null);
    },
  });
  const toggleArchive = useMutation<unknown, ApiError, Project>({
    mutationFn: (p) => api(`/companies/${company.id}/projects/${p.id}/${p.archivedAt ? 'unarchive' : 'archive'}`, { method: 'POST' }),
    onSuccess: invalidate,
  });

  if (projects.isPending || templates.isPending) return <div className="text-muted">Загрузка…</div>;
  if (projects.error || templates.error) return <div className="text-expense">{(projects.error ?? templates.error)!.message}</div>;
  const tpl = (key: string) => templates.data.find((t) => t.key === key);

  return (
    <section>
      <SettingsNav companyId={company.id} />
      <div className="mb-4 flex items-center justify-between gap-4">
        <h1 className="text-2xl font-bold">Проекты</h1>
        {!readOnly && !creating && (
          <button type="button" onClick={() => setCreating(true)} className={btnPrimary}>
            Добавить проект
          </button>
        )}
      </div>
      {readOnly && <p className="mb-4 rounded-xl bg-field px-4 py-3 text-sm text-muted">Компания в архиве — изменения недоступны.</p>}
      {toggleArchive.error && (
        <p role="alert" className="mb-4 rounded-xl bg-expense-soft px-4 py-3 text-sm text-expense">
          {toggleArchive.error.message}
        </p>
      )}
      {creating && (
        <div className="mb-6">
          <ProjectForm
            templates={templates.data}
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
      {projects.data.length === 0 && !creating && (
        <p className="text-muted">Проектов пока нет. Проект — это клуб, магазин или офис внутри компании.</p>
      )}
      <ul className="space-y-2">
        {projects.data.map((p) => (
          <li key={p.id} className={`rounded-2xl border border-field p-4 ${p.archivedAt ? 'opacity-60' : ''}`}>
            {editingId === p.id ? (
              <ProjectForm
                templates={templates.data}
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
                {!readOnly && (
                  <div className="flex gap-2">
                    {!p.archivedAt && (
                      <button type="button" onClick={() => setEditingId(p.id)} className={btnSecondary}>
                        Изменить
                      </button>
                    )}
                    <button type="button" onClick={() => toggleArchive.mutate(p)} className={p.archivedAt ? btnSecondary : btnDanger}>
                      {p.archivedAt ? 'Вернуть из архива' : 'В архив'}
                    </button>
                  </div>
                )}
              </div>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}
