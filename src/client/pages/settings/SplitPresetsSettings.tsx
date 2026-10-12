import { useMutation } from '@tanstack/react-query';
import { useState, type FormEvent } from 'react';
import { useOutletContext } from 'react-router';
import { formatBp, parsePercentToBp } from '../../../shared/percent';
import { SPLIT_TOTAL_BP } from '../../../shared/schemas/split-presets';
import { ArchivedNote, EntityActions } from '../../components/EntityActions';
import { Field } from '../../components/Field';
import { Modal } from '../../components/Modal';
import { Pending, StaleNotice } from '../../components/QueryState';
import { SettingsList } from '../../components/SettingsList';
import { alertClass, btnIcon, btnPrimary, btnSecondary, btnSmall, inputClass, noticeClass } from '../../components/ui';
import { api, type ApiError } from '../../lib/api';
import { mergeSubsetOrder } from '../../lib/order';
import { queryClient } from '../../lib/query';
import { useCategories, useProjects, useSplitPresets, type CategoryNode, type CategoryTree, type Project, type SplitLine, type SplitPreset } from '../../lib/queries';
import { useEntityActions, useReorder } from '../../lib/settings-mutations';
import { useEditedItem, useHeldWhile, type EditingId } from '../../lib/use-edited';
import type { CompanyOutletContext } from '../CompanyLayout';
import { ProjectsHeader } from './ProjectsTabs';

type Kind = 'income' | 'expense';

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

/** Категории дерева плоским списком: «Родитель», «Родитель → Дочерняя». */
function flatten(nodes: CategoryNode[]): Option[] {
  return nodes.flatMap((n) => [
    { id: n.id, label: n.name, archived: n.archivedAt !== null },
    ...n.children.map((c) => ({ id: c.id, label: `${n.name} → ${c.name}`, archived: c.archivedAt !== null || n.archivedAt !== null })),
  ]);
}

function toDraft(p: SplitPreset, tree: CategoryTree): Draft {
  const income = flatten(tree.income);
  const expense = flatten(tree.expense);
  // вид — по первой строке, чья категория ещё существует (удалённые категории вида не определяют)
  const known = p.lines.find((l) => l.categoryId !== null && [...income, ...expense].some((o) => o.id === l.categoryId));
  const isIncome = known !== undefined && income.some((o) => o.id === known.categoryId);
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

/** Подпись поля строки на телефоне, где заголовков таблицы нет; у полей есть свои aria-label. */
function MobileLabel({ children }: { children: string }) {
  return (
    <span aria-hidden="true" className="mb-1 block text-xs text-muted md:hidden">
      {children}
    </span>
  );
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
  // поля сервера, кроме name (он показан у своего input): lines, lines.0.bp и т.п.
  const alertMessages = [
    ...Object.entries(props.serverFields ?? {})
      .filter(([key]) => key !== 'name')
      .map(([, message]) => message),
    ...(props.serverError ? [props.serverError] : []),
  ];
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
    <form onSubmit={submit} noValidate className="space-y-4">
      <div className="grid gap-3 md:grid-cols-2">
        <Field label="Название шаблона" error={props.serverFields?.name}>
          {(c) => <input {...c} autoFocus value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} className={inputClass} />}
        </Field>
        <Field label="Вид категорий">
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
      {/* на телефоне строка — карточкой: категория во всю ширину, под ней проект, доля и «×» */}
      <table className="w-full text-sm max-md:block">
        <thead className="max-md:hidden">
          <tr className="text-left text-muted">
            <th className="pb-1 font-normal">Категория</th>
            <th className="pb-1 font-normal">Проект</th>
            <th className="w-32 pb-1 font-normal">Доля, %</th>
            <th className="w-12 pb-1">
              <span className="sr-only">Удалить строку</span>
            </th>
          </tr>
        </thead>
        <tbody className="max-md:block">
          {draft.lines.map((l, i) => (
            <tr key={i} className="max-md:mb-3 max-md:grid max-md:grid-cols-[minmax(0,1fr)_6rem_auto] max-md:items-end max-md:gap-x-2">
              <td className="pb-2 pr-2 max-md:col-span-3 max-md:pr-0">
                <MobileLabel>Категория</MobileLabel>
                <OptionSelect label={`Категория, строка ${i + 1}`} value={l.categoryId} options={categoryOptions} onChange={(v) => setLine(i, { categoryId: v })} />
              </td>
              <td className="pb-2 pr-2 max-md:pr-0">
                <MobileLabel>Проект</MobileLabel>
                <OptionSelect label={`Проект, строка ${i + 1}`} value={l.projectId} options={projectOptions} onChange={(v) => setLine(i, { projectId: v })} />
              </td>
              <td className="pb-2 pr-2 max-md:pr-0">
                <MobileLabel>Доля, %</MobileLabel>
                <input
                  aria-label={`Доля %, строка ${i + 1}`}
                  aria-invalid={l.percent !== '' && parsed[i] === null ? true : undefined}
                  aria-describedby={l.percent !== '' && parsed[i] === null ? `percent-error-${i}` : undefined}
                  inputMode="decimal"
                  value={l.percent}
                  onChange={(e) => setLine(i, { percent: e.target.value })}
                  className={inputClass}
                />
                {l.percent !== '' && parsed[i] === null && (
                  <span id={`percent-error-${i}`} className="mt-1 block text-sm text-expense-strong">
                    Введите число, например 33,33
                  </span>
                )}
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
        <p role="status" className={`text-sm font-semibold ${total === SPLIT_TOTAL_BP ? 'text-income' : 'text-expense-strong'}`}>
          Распределено {formatBp(total)}% из 100%
          {total !== SPLIT_TOTAL_BP && ` · ${total < SPLIT_TOTAL_BP ? 'осталось' : 'лишние'} ${formatBp(Math.abs(SPLIT_TOTAL_BP - total))}%`}
        </p>
      </div>
      {alertMessages.length > 0 && (
        <p role="alert" className="rounded-xl bg-expense-soft px-4 py-3 text-sm text-expense-strong">
          {alertMessages.join('. ')}
        </p>
      )}
      <div className="flex flex-wrap gap-2">
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

/** Окно шаблона: 'new' — «Новый шаблон», id — «Шаблон разделения» (свежие данные из списка), null — закрыто. */
type Editing = EditingId;

/**
 * «Шаблоны разделения» — вкладка раздела «Проекты» (§7.4 этапа 1.5): шаблон списка, «Создать шаблон» и ✎ —
 * окно редактора; серый текст строки — доли шаблона.
 */
export function SplitPresetsSettings() {
  const { company } = useOutletContext<CompanyOutletContext>();
  const presets = useSplitPresets(company.id);
  const categories = useCategories(company.id);
  const projects = useProjects(company.id);
  const [editing, setEditing] = useState<Editing>(null);
  const [listError, setListError] = useState<string | null>(null);
  const readOnly = company.archivedAt !== null;
  const reorder = useReorder<SplitPreset>(['split-presets', company.id], `/companies/${company.id}/split-presets/reorder`, setListError);
  const edited = useEditedItem(presets.data, editing);

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
      <ProjectsHeader companyId={company.id} />
      <StaleNotice queries={[presets, categories, projects]} />
      <p className="mb-4 text-sm text-muted">Шаблон делит сумму операции между категориями и проектами в заданных долях; сумма долей — ровно 100%.</p>
      {readOnly && <p className={noticeClass}>Компания в архиве — изменения недоступны.</p>}
      {listError && (
        <p role="alert" className={alertClass}>
          {listError}
        </p>
      )}
      <SettingsList
        label="Шаблоны разделения"
        rows={list.map((p) => ({ id: p.id, name: p.name, secondary: summary(p), archived: p.archivedAt !== null }))}
        addLabel={readOnly ? null : 'Создать шаблон'}
        onAdd={() => setEditing('new')}
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
        onEdit={readOnly ? undefined : (row) => setEditing(row.id)}
        empty="Шаблонов пока нет."
      />
      <Modal open={editing !== null} title={editing === 'new' ? 'Новый шаблон' : 'Шаблон разделения'} onClose={() => setEditing(null)} className="max-w-2xl">
        {editing !== null && (
          <PresetEditor key={editing} companyId={company.id} preset={edited.item} gone={edited.gone} tree={tree} projects={projectList} onDone={() => setEditing(null)} />
        )}
      </Modal>
    </section>
  );
}

function PresetEditor(props: { companyId: number; preset: SplitPreset | null; gone: boolean; tree: CategoryTree; projects: Project[]; onDone: () => void }) {
  const { onDone } = props;
  const fresh = props.preset;
  const base = `/companies/${props.companyId}/split-presets`;
  const refresh = () => queryClient.invalidateQueries({ queryKey: ['split-presets', props.companyId] });
  const save = useMutation<unknown, ApiError, { name: string; lines: SplitLine[] }>({
    mutationFn: (body) => (fresh ? api(`${base}/${fresh.id}`, { method: 'PATCH', body }) : api(base, { method: 'POST', body })),
    onSuccess: async () => {
      await refresh();
      onDone();
    },
  });
  const actions = useEntityActions(fresh ? `${base}/${fresh.id}` : base, refresh, onDone);
  // во время своего запроса — шаблон такой, каким был при нажатии (R5)
  const busy = actions.pending || save.isPending;
  const preset = useHeldWhile(fresh, busy);

  if (props.gone && !busy) return <p className="text-muted">Шаблон не найден — возможно, его удалили.</p>;
  return (
    <>
      {preset?.archivedAt ? (
        <ArchivedNote />
      ) : (
        <PresetForm
          initial={preset ? toDraft(preset, props.tree) : { name: '', kind: 'expense', lines: [emptyLine(), emptyLine()] }}
          tree={props.tree}
          projects={props.projects}
          submitLabel="Сохранить шаблон"
          pending={save.isPending}
          serverFields={save.error?.fields}
          serverError={save.error && !save.error.fields ? save.error.message : undefined}
          onSubmit={(body) => save.mutate(body)}
          onCancel={onDone}
        />
      )}
      {preset && (
        <EntityActions
          archived={preset.archivedAt !== null}
          onArchiveToggle={() => actions.toggleArchive(preset.archivedAt !== null)}
          what={`шаблон «${preset.name}»`}
          onDelete={actions.remove}
          pending={actions.pending}
          error={actions.error}
        />
      )}
    </>
  );
}
