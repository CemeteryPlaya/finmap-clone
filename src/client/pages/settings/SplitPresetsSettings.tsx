import { useMutation } from '@tanstack/react-query';
import { useState, type FormEvent } from 'react';
import { useOutletContext } from 'react-router';
import { formatBp, parsePercentToBp } from '../../../shared/percent';
import { SPLIT_TOTAL_BP } from '../../../shared/schemas/split-presets';
import { ConfirmDelete } from '../../components/ConfirmDelete';
import { Field } from '../../components/Field';
import { Pending, StaleNotice } from '../../components/QueryState';
import { alertClass, btnIcon, btnPrimary, btnSecondary, btnSmall, inputClass, noticeClass } from '../../components/ui';
import { api, type ApiError } from '../../lib/api';
import { queryClient } from '../../lib/query';
import { useCategories, useProjects, useSplitPresets, type CategoryNode, type CategoryTree, type Project, type SplitLine, type SplitPreset } from '../../lib/queries';
import type { CompanyOutletContext } from '../CompanyLayout';
import { SettingsNav } from './SettingsNav';

type Kind = 'income' | 'expense';
type Action = { path: string; method: 'POST' | 'DELETE' };

interface LineDraft {
  categoryId: string;
  projectId: string;
  percent: string;
}

interface Draft {
  name: string;
  kind: Kind;
  lines: LineDraft[];
}

interface Option {
  id: number;
  label: string;
  archived: boolean;
}

const emptyLine = (): LineDraft => ({ categoryId: '', projectId: '', percent: '' });

/** Статьи дерева плоским списком: «Родитель», «Родитель → Дочерняя». */
function flatten(nodes: CategoryNode[]): Option[] {
  return nodes.flatMap((n) => [
    { id: n.id, label: n.name, archived: n.archivedAt !== null },
    ...n.children.map((c) => ({ id: c.id, label: `${n.name} → ${c.name}`, archived: c.archivedAt !== null || n.archivedAt !== null })),
  ]);
}

function toDraft(p: SplitPreset, tree: CategoryTree): Draft {
  const firstCategory = p.lines.find((l) => l.categoryId !== null)?.categoryId;
  const isIncome = firstCategory != null && flatten(tree.income).some((o) => o.id === firstCategory);
  return {
    name: p.name,
    kind: isIncome ? 'income' : 'expense',
    lines: p.lines.map((l) => ({
      categoryId: l.categoryId === null ? '' : String(l.categoryId),
      projectId: l.projectId === null ? '' : String(l.projectId),
      percent: formatBp(l.bp),
    })),
  };
}

/** Выпадающий список: архивные не предлагаются, но уже выбранный архивный элемент виден с пометкой. */
function OptionSelect(props: { label: string; value: string; options: Option[]; onChange: (value: string) => void }) {
  const selected = props.options.find((o) => String(o.id) === props.value);
  return (
    <select aria-label={props.label} value={props.value} onChange={(e) => props.onChange(e.target.value)} className={inputClass}>
      <option value="">—</option>
      {props.options
        .filter((o) => !o.archived)
        .map((o) => (
          <option key={o.id} value={o.id}>
            {o.label}
          </option>
        ))}
      {selected?.archived && <option value={props.value}>{selected.label} (в архиве)</option>}
      {props.value !== '' && !selected && <option value={props.value}>(удалено)</option>}
    </select>
  );
}

function PresetForm(props: {
  initial: Draft;
  tree: CategoryTree;
  projects: Project[];
  submitLabel: string;
  pending: boolean;
  serverFields?: Record<string, string>;
  serverError?: string;
  onSubmit: (body: { name: string; lines: SplitLine[] }) => void;
  onCancel: () => void;
}) {
  const [draft, setDraft] = useState(props.initial);
  const categoryOptions = flatten(props.tree[draft.kind]);
  const projectOptions: Option[] = props.projects.map((p) => ({ id: p.id, label: p.name, archived: p.archivedAt !== null }));
  const parsed = draft.lines.map((l) => parsePercentToBp(l.percent));
  const total = parsed.reduce<number>((s, bp) => s + (bp ?? 0), 0);
  const linesValid = draft.lines.every((l, i) => (parsed[i] ?? 0) > 0 && (l.categoryId !== '' || l.projectId !== ''));
  const canSave = draft.name.trim() !== '' && linesValid && total === SPLIT_TOTAL_BP && !props.pending;
  const setLine = (i: number, patch: Partial<LineDraft>) =>
    setDraft({ ...draft, lines: draft.lines.map((l, j) => (j === i ? { ...l, ...patch } : l)) });

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!canSave) return;
    props.onSubmit({
      name: draft.name,
      lines: draft.lines.map((l, i) => ({
        categoryId: l.categoryId ? Number(l.categoryId) : null,
        projectId: l.projectId ? Number(l.projectId) : null,
        bp: parsed[i] ?? 0,
      })),
    });
  };

  return (
    <form onSubmit={submit} noValidate className="space-y-4 rounded-2xl bg-canvas p-4">
      <div className="grid gap-3 md:grid-cols-2">
        <Field label="Название шаблона" error={props.serverFields?.name}>
          {(c) => <input {...c} autoFocus value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} className={inputClass} />}
        </Field>
        <Field label="Вид статей">
          {(c) => (
            <select
              {...c}
              value={draft.kind}
              onChange={(e) => setDraft({ ...draft, kind: e.target.value as Kind, lines: draft.lines.map((l) => ({ ...l, categoryId: '' })) })}
              className={inputClass}
            >
              <option value="expense">Расходы</option>
              <option value="income">Доходы</option>
            </select>
          )}
        </Field>
      </div>
      <table className="w-full text-sm">
        <thead>
          <tr className="text-left text-muted">
            <th className="pb-1 font-normal">Статья</th>
            <th className="pb-1 font-normal">Проект</th>
            <th className="w-32 pb-1 font-normal">Доля, %</th>
            <th className="w-12 pb-1">
              <span className="sr-only">Удалить строку</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {draft.lines.map((l, i) => (
            <tr key={i}>
              <td className="pb-2 pr-2">
                <OptionSelect label={`Статья, строка ${i + 1}`} value={l.categoryId} options={categoryOptions} onChange={(v) => setLine(i, { categoryId: v })} />
              </td>
              <td className="pb-2 pr-2">
                <OptionSelect label={`Проект, строка ${i + 1}`} value={l.projectId} options={projectOptions} onChange={(v) => setLine(i, { projectId: v })} />
              </td>
              <td className="pb-2 pr-2">
                <input
                  aria-label={`Доля %, строка ${i + 1}`}
                  aria-invalid={l.percent !== '' && parsed[i] === null ? true : undefined}
                  inputMode="decimal"
                  value={l.percent}
                  onChange={(e) => setLine(i, { percent: e.target.value })}
                  className={inputClass}
                />
              </td>
              <td className="pb-2">
                <button
                  type="button"
                  aria-label={`Удалить строку ${i + 1}`}
                  disabled={draft.lines.length <= 1}
                  onClick={() => setDraft({ ...draft, lines: draft.lines.filter((_, j) => j !== i) })}
                  className={btnIcon}
                >
                  ×
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <button
          type="button"
          disabled={draft.lines.length >= 20}
          onClick={() => setDraft({ ...draft, lines: [...draft.lines, emptyLine()] })}
          className={btnSmall}
        >
          + Строка
        </button>
        <p role="status" className={`text-sm font-semibold ${total === SPLIT_TOTAL_BP ? 'text-income' : 'text-expense'}`}>
          Распределено {formatBp(total)}% из 100%
          {total !== SPLIT_TOTAL_BP && ` · ${total < SPLIT_TOTAL_BP ? 'осталось' : 'лишние'} ${formatBp(Math.abs(SPLIT_TOTAL_BP - total))}%`}
        </p>
      </div>
      {(props.serverFields?.lines ?? props.serverError) && (
        <p role="alert" className="rounded-xl bg-expense-soft px-4 py-3 text-sm text-expense">
          {props.serverFields?.lines ?? props.serverError}
        </p>
      )}
      <div className="flex gap-2">
        <button type="submit" disabled={!canSave} className={btnPrimary}>
          {props.submitLabel}
        </button>
        <button type="button" onClick={props.onCancel} className={btnSecondary}>
          Отмена
        </button>
      </div>
    </form>
  );
}

export function SplitPresetsSettings() {
  const { company } = useOutletContext<CompanyOutletContext>();
  const presets = useSplitPresets(company.id);
  const categories = useCategories(company.id);
  const projects = useProjects(company.id);
  const [creating, setCreating] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [deletingId, setDeletingId] = useState<number | null>(null);
  const readOnly = company.archivedAt !== null;
  const base = `/companies/${company.id}/split-presets`;
  const invalidate = () => queryClient.invalidateQueries({ queryKey: ['split-presets', company.id] });

  const create = useMutation<unknown, ApiError, { name: string; lines: SplitLine[] }>({
    mutationFn: (body) => api(base, { method: 'POST', body }),
    onSuccess: async () => {
      await invalidate();
      setCreating(false);
    },
  });
  const update = useMutation<unknown, ApiError, { id: number; body: { name: string; lines: SplitLine[] } }>({
    mutationFn: ({ id, body }) => api(`${base}/${id}`, { method: 'PATCH', body }),
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

  if (!presets.data || !categories.data || !projects.data) return <Pending queries={[presets, categories, projects]} />;
  const list = presets.data;
  const tree = categories.data;
  const projectList = projects.data;
  const categoryLabel = new Map([...flatten(tree.income), ...flatten(tree.expense)].map((o) => [o.id, o.label]));
  const projectName = new Map(projectList.map((p) => [p.id, p.name]));
  const summary = (p: SplitPreset) =>
    p.lines
      .map((l) => {
        const parts = [
          l.categoryId === null ? null : (categoryLabel.get(l.categoryId) ?? '(удалено)'),
          l.projectId === null ? null : (projectName.get(l.projectId) ?? '(удалено)'),
        ].filter(Boolean);
        return `${parts.join(' · ')} — ${formatBp(l.bp)}%`;
      })
      .join('; ');

  return (
    <section>
      <SettingsNav companyId={company.id} />
      <StaleNotice queries={[presets, categories, projects]} />
      <div className="mb-4 flex items-center justify-between gap-4">
        <h1 className="text-2xl font-bold">Шаблоны разделения</h1>
        {!readOnly && !creating && (
          <button
            type="button"
            onClick={() => {
              resetMessages();
              setEditingId(null);
              setCreating(true);
            }}
            className={btnPrimary}
          >
            Добавить шаблон
          </button>
        )}
      </div>
      <p className="mb-4 text-sm text-muted">Шаблон делит сумму операции между статьями и проектами в заданных долях; сумма долей — ровно 100%.</p>
      {readOnly && <p className={noticeClass}>Компания в архиве — изменения недоступны.</p>}
      {action.error && (
        <p role="alert" className={alertClass}>
          {action.error.message}
        </p>
      )}
      {creating && (
        <div className="mb-6">
          <PresetForm
            initial={{ name: '', kind: 'expense', lines: [emptyLine(), emptyLine()] }}
            tree={tree}
            projects={projectList}
            submitLabel="Сохранить шаблон"
            pending={create.isPending}
            serverFields={create.error?.fields}
            serverError={create.error && !create.error.fields ? create.error.message : undefined}
            onSubmit={(body) => create.mutate(body)}
            onCancel={() => {
              setCreating(false);
              create.reset();
            }}
          />
        </div>
      )}
      {list.length === 0 && !creating && <p className="text-muted">Шаблонов пока нет.</p>}
      <ul className="space-y-2">
        {list.map((p) => (
          <li key={p.id} className={`rounded-2xl border border-field p-4 ${p.archivedAt ? 'opacity-60' : ''}`}>
            {editingId === p.id ? (
              <PresetForm
                initial={toDraft(p, tree)}
                tree={tree}
                projects={projectList}
                submitLabel="Сохранить шаблон"
                pending={update.isPending}
                serverFields={update.error?.fields}
                serverError={update.error && !update.error.fields ? update.error.message : undefined}
                onSubmit={(body) => update.mutate({ id: p.id, body })}
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
                  <div className="text-sm text-muted">{summary(p)}</div>
                </div>
                {!readOnly &&
                  (deletingId === p.id ? (
                    <ConfirmDelete
                      what={`шаблон «${p.name}»`}
                      pending={action.isPending}
                      onConfirm={() => action.mutate({ path: `${base}/${p.id}`, method: 'DELETE' })}
                      onCancel={() => setDeletingId(null)}
                    />
                  ) : (
                    <div className="flex flex-wrap gap-2">
                      {!p.archivedAt && (
                        <button
                          type="button"
                          onClick={() => {
                            resetMessages();
                            setCreating(false);
                            setEditingId(p.id);
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
                          action.mutate({ path: `${base}/${p.id}/${p.archivedAt ? 'unarchive' : 'archive'}`, method: 'POST' });
                        }}
                        className={btnSmall}
                      >
                        {p.archivedAt ? 'Вернуть из архива' : 'В архив'}
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          resetMessages();
                          setDeletingId(p.id);
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
    </section>
  );
}
