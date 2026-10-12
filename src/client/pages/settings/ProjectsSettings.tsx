import { useMutation } from '@tanstack/react-query';
import { useState } from 'react';
import { useOutletContext } from 'react-router';
import { ArchivedNote, EntityActions } from '../../components/EntityActions';
import { Modal } from '../../components/Modal';
import { ProjectForm, type ProjectFormValues } from '../../components/ProjectForm';
import { Pending, StaleNotice } from '../../components/QueryState';
import { SettingsList } from '../../components/SettingsList';
import { alertClass, noticeClass } from '../../components/ui';
import { api, type ApiError } from '../../lib/api';
import { mergeSubsetOrder } from '../../lib/order';
import { queryClient } from '../../lib/query';
import { useProjects, useTemplates, type Project, type TemplateInfo } from '../../lib/queries';
import { useEntityActions, useReorder } from '../../lib/settings-mutations';
import { useEditedItem, useHeldWhile, type EditingId } from '../../lib/use-edited';
import type { CompanyOutletContext } from '../CompanyLayout';
import { ProjectsHeader } from './ProjectsTabs';

/** Серый текст строки: тип бизнеса и параметры шаблона. */
function projectSummary(p: Project, t: TemplateInfo | undefined): string {
  const params = (t?.paramsUi ?? []).map((u) => `${u.label}: ${String(p.templateParams[u.key] ?? '—')}`).join(', ');
  return [t?.name ?? p.templateKey, params].filter((s) => s !== '').join(' · ');
}

/** Окно проекта: 'new' — «Новый проект», id — «Проект» (свежие данные из списка), null — закрыто. */
type Editing = EditingId;

/** «Проекты» на шаблоне списка (§7.4 этапа 1.5): «Добавить проект» и ✎ — окно проекта (шаблон, затем параметры). */
export function ProjectsSettings() {
  const { company } = useOutletContext<CompanyOutletContext>();
  const projects = useProjects(company.id);
  const templates = useTemplates();
  const [editing, setEditing] = useState<Editing>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [listError, setListError] = useState<string | null>(null);
  const readOnly = company.archivedAt !== null;
  const reorder = useReorder<Project>(['projects', company.id], `/companies/${company.id}/projects/reorder`, setListError);
  const edited = useEditedItem(projects.data, editing);

  if (!projects.data || !templates.data) return <Pending queries={[projects, templates]} />;
  const list = projects.data;
  const templateList = templates.data;
  const open = (next: Editing) => {
    setNotice(null);
    setEditing(next);
  };
  const close = () => setEditing(null);

  return (
    <section>
      <ProjectsHeader companyId={company.id} />
      <StaleNotice queries={[projects, templates]} />
      {readOnly && <p className={noticeClass}>Компания в архиве — изменения недоступны.</p>}
      {/* живая область на месте всегда: вставленная сразу с текстом часто не объявляется */}
      <p role="status" className={notice ? noticeClass : 'sr-only'}>
        {notice}
      </p>
      {listError && (
        <p role="alert" className={alertClass}>
          {listError}
        </p>
      )}
      <SettingsList
        label="Проекты"
        rows={list.map((p) => ({
          id: p.id,
          name: p.name,
          secondary: projectSummary(
            p,
            templateList.find((t) => t.key === p.templateKey),
          ),
          archived: p.archivedAt !== null,
        }))}
        addLabel={readOnly ? null : 'Добавить проект'}
        onAdd={() => open('new')}
        onReorder={
          readOnly
            ? undefined
            : (group) =>
                reorder.mutate(
                  mergeSubsetOrder(
                    list.map((p) => p.id),
                    group,
                  ),
                )
        }
        onEdit={readOnly ? undefined : (row) => open(row.id)}
        empty="Проектов пока нет. Проект — это клуб, магазин или офис внутри компании."
      />
      <Modal open={editing !== null} title={editing === 'new' ? 'Новый проект' : 'Проект'} onClose={close} className="max-w-lg">
        {editing !== null && (
          <ProjectEditor
            key={editing}
            companyId={company.id}
            templates={templateList}
            project={edited.item}
            gone={edited.gone}
            onRenamed={(count) => setNotice(`Переименовано счетов: ${count}`)}
            onDone={close}
          />
        )}
      </Modal>
    </section>
  );
}

function ProjectEditor(props: {
  companyId: number;
  templates: TemplateInfo[];
  project: Project | null;
  gone: boolean;
  onRenamed: (count: number) => void;
  onDone: () => void;
}) {
  const { onDone } = props;
  const fresh = props.project;
  const base = `/companies/${props.companyId}/projects`;
  // шаблон создаёт счета и категории проекта
  const refresh = () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: ['projects', props.companyId] }),
      queryClient.invalidateQueries({ queryKey: ['accounts', props.companyId] }),
      queryClient.invalidateQueries({ queryKey: ['categories', props.companyId] }),
    ]);
  const create = useMutation<unknown, ApiError, ProjectFormValues>({
    mutationFn: (v) => api(base, { method: 'POST', body: { name: v.name, templateKey: v.templateKey, templateParams: v.templateParams } }),
    onSuccess: async () => {
      await refresh();
      onDone();
    },
  });
  const update = useMutation<{ renamedAccounts: number }, ApiError, ProjectFormValues>({
    mutationFn: (v) =>
      api(`${base}/${fresh!.id}`, {
        method: 'PATCH',
        body: { name: v.name, templateParams: v.templateParams, ...(v.renameAccounts !== undefined ? { renameAccounts: v.renameAccounts } : {}) },
      }),
    onSuccess: async (res) => {
      await refresh();
      if (res.renamedAccounts > 0) props.onRenamed(res.renamedAccounts);
      onDone();
    },
  });
  const actions = useEntityActions(fresh ? `${base}/${fresh.id}` : base, refresh, onDone);
  // во время своего запроса — проект такой, каким был при нажатии (R5)
  const busy = actions.pending || create.isPending || update.isPending;
  const project = useHeldWhile(fresh, busy);
  const error = project ? update.error : create.error;

  if (props.gone && !busy) return <p className="text-muted">Проект не найден — возможно, его удалили.</p>;
  return (
    <>
      {project?.archivedAt ? (
        <ArchivedNote />
      ) : (
        <ProjectForm
          templates={props.templates}
          mode={project ? 'edit' : 'create'}
          initial={project ? { name: project.name, templateKey: project.templateKey, templateParams: project.templateParams } : undefined}
          pending={create.isPending || update.isPending}
          serverFields={error?.fields}
          serverError={error && !error.fields ? error.message : undefined}
          onSubmit={(v) => (project ? update.mutate(v) : create.mutate(v))}
          onCancel={onDone}
        />
      )}
      {project && (
        <EntityActions
          archived={project.archivedAt !== null}
          onArchiveToggle={() => actions.toggleArchive(project.archivedAt !== null)}
          what={`проект «${project.name}»`}
          onDelete={actions.remove}
          pending={actions.pending}
          error={actions.error}
        />
      )}
    </>
  );
}
