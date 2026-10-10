import { useMutation } from '@tanstack/react-query';
import { useState, type FormEvent } from 'react';
import { useOutletContext } from 'react-router';
import { ConfirmDelete } from '../../components/ConfirmDelete';
import { Field } from '../../components/Field';
import { Pending, StaleNotice } from '../../components/QueryState';
import { ReorderButtons } from '../../components/ReorderButtons';
import { alertClass, btnPrimary, btnSecondary, btnSmall, inputClass, noticeClass } from '../../components/ui';
import { api, type ApiError } from '../../lib/api';
import { parentChoices, planMove, planShift, type MovePlan } from '../../lib/category-moves';
import { queryClient } from '../../lib/query';
import { useCategories, type CategoryNode } from '../../lib/queries';
import type { CompanyOutletContext } from '../CompanyLayout';
import { SettingsNav } from './SettingsNav';

type Kind = 'income' | 'expense';
type Action = { path: string; method: 'POST' | 'PATCH' | 'DELETE'; body?: unknown };

const TITLES: Record<Kind, string> = { income: 'Доходы', expense: 'Расходы' };
const badge = 'ml-2 rounded-full bg-field px-2 py-0.5 text-xs text-muted';

function TreeSection(props: {
  kind: Kind;
  nodes: CategoryNode[];
  base: string;
  readOnly: boolean;
  pending: boolean;
  /** true — запрос прошёл. */
  run: (a: Action) => Promise<boolean>;
  onLocalError: (message: string) => void;
}) {
  const { kind, nodes, base } = props;
  const [name, setName] = useState('');
  const [parentId, setParentId] = useState('');
  const [renamingId, setRenamingId] = useState<number | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const [deletingId, setDeletingId] = useState<number | null>(null);
  const [dragId, setDragId] = useState<number | null>(null);

  const move = (plan: MovePlan | string | null) => {
    if (plan === null) return;
    if (typeof plan === 'string') props.onLocalError(plan);
    else void props.run({ path: `${base}/reorder`, method: 'POST', body: plan });
  };
  const add = async (e: FormEvent) => {
    e.preventDefault();
    if (await props.run({ path: base, method: 'POST', body: { kind, name, parentId: parentId ? Number(parentId) : null } })) setName('');
  };
  const dropPlan = (target: CategoryNode) =>
    dragId === null ? null : planMove(nodes, dragId, { parentId: target.parentId, beforeId: target.id });

  const row = (n: CategoryNode) => {
    const editable = !props.readOnly && !n.systemKey;
    const choices = parentChoices(nodes, n);
    const canChooseParent = editable && !n.archivedAt && (choices.length > 0 || n.parentId !== null);
    const up = planShift(nodes, n.id, -1);
    const down = planShift(nodes, n.id, 1);
    return (
      // имя строки — название категории: текст строки включает подписи выпадающего списка «Перенести в…»
      <li key={n.id} aria-label={n.name}>
        <div
          draggable={!props.readOnly && renamingId !== n.id}
          onDragStart={(e) => {
            e.dataTransfer.setData('text/plain', String(n.id));
            e.dataTransfer.effectAllowed = 'move';
            setDragId(n.id);
          }}
          onDragEnd={() => setDragId(null)}
          onDragOver={(e) => {
            const plan = dragId !== n.id ? dropPlan(n) : null;
            if (plan !== null && typeof plan !== 'string') e.preventDefault();
          }}
          onDrop={(e) => {
            e.preventDefault();
            const plan = dropPlan(n);
            setDragId(null);
            move(plan);
          }}
          className={`flex flex-wrap items-center justify-between gap-2 rounded-xl px-3 py-2 hover:bg-field ${n.archivedAt ? 'opacity-60' : ''}`}
        >
          {renamingId === n.id ? (
            <form
              className="flex flex-1 flex-wrap items-center gap-2"
              onSubmit={async (e) => {
                e.preventDefault();
                if (await props.run({ path: `${base}/${n.id}`, method: 'PATCH', body: { name: renameValue } })) setRenamingId(null);
              }}
            >
              <input
                aria-label={`Новое название категории «${n.name}»`}
                autoFocus
                value={renameValue}
                onChange={(e) => setRenameValue(e.target.value)}
                className={inputClass}
              />
              <button type="submit" disabled={!renameValue.trim() || props.pending} className={btnPrimary}>
                Сохранить
              </button>
              <button type="button" onClick={() => setRenamingId(null)} className={btnSecondary}>
                Отмена
              </button>
            </form>
          ) : (
            <>
              <span className="min-w-0">
                {!props.readOnly && (
                  <span aria-hidden="true" className="mr-2 cursor-grab text-muted">
                    ⠿
                  </span>
                )}
                {n.name}
                {n.systemKey && <span className={badge}>системная</span>}
                {n.archivedAt && <span className={badge}>в архиве</span>}
              </span>
              {!props.readOnly &&
                (deletingId === n.id ? (
                  <ConfirmDelete
                    what={`категорию «${n.name}»`}
                    pending={props.pending}
                    onConfirm={async () => {
                      if (await props.run({ path: `${base}/${n.id}`, method: 'DELETE' })) setDeletingId(null);
                    }}
                    onCancel={() => setDeletingId(null)}
                  />
                ) : (
                  <span className="flex min-w-0 max-w-full flex-wrap items-center gap-2">
                    <ReorderButtons label={n.name} disabled={props.pending} onUp={up ? () => move(up) : null} onDown={down ? () => move(down) : null} />
                    {canChooseParent && (
                      <select
                        aria-label={`Перенести «${n.name}»`}
                        value=""
                        onChange={(e) =>
                          move(planMove(nodes, n.id, { parentId: e.target.value === 'top' ? null : Number(e.target.value), beforeId: null }))
                        }
                        className="rounded-lg bg-field px-2 py-1.5 text-sm"
                      >
                        <option value="" disabled>
                          Перенести в…
                        </option>
                        {n.parentId !== null && <option value="top">Верхний уровень</option>}
                        {choices.map((p) => (
                          <option key={p.id} value={p.id}>
                            {p.name}
                          </option>
                        ))}
                      </select>
                    )}
                    {editable && !n.archivedAt && (
                      <button
                        type="button"
                        onClick={() => {
                          setRenameValue(n.name);
                          setRenamingId(n.id);
                        }}
                        className={btnSmall}
                      >
                        Переименовать
                      </button>
                    )}
                    {editable && (
                      <button
                        type="button"
                        onClick={() => void props.run({ path: `${base}/${n.id}/${n.archivedAt ? 'unarchive' : 'archive'}`, method: 'POST' })}
                        className={btnSmall}
                      >
                        {n.archivedAt ? 'Вернуть из архива' : 'В архив'}
                      </button>
                    )}
                    {editable && (
                      <button type="button" onClick={() => setDeletingId(n.id)} className={btnSmall}>
                        Удалить
                      </button>
                    )}
                  </span>
                ))}
            </>
          )}
        </div>
        {n.children.length > 0 && <ul className="ml-6 border-l border-field pl-2">{n.children.map((c) => row(c))}</ul>}
      </li>
    );
  };

  return (
    <section aria-labelledby={`categories-${kind}`} className="rounded-2xl border border-field p-4">
      <h2 id={`categories-${kind}`} className="mb-3 text-lg font-semibold">
        {TITLES[kind]}
      </h2>
      {!props.readOnly && (
        <form onSubmit={add} className="mb-4 grid gap-2 md:grid-cols-[1fr_12rem_auto] md:items-end">
          <Field label={kind === 'income' ? 'Новая категория доходов' : 'Новая категория расходов'}>
            {(c) => <input {...c} value={name} onChange={(e) => setName(e.target.value)} className={inputClass} />}
          </Field>
          <Field label="Родитель">
            {(c) => (
              <select {...c} value={parentId} onChange={(e) => setParentId(e.target.value)} className={inputClass}>
                <option value="">Верхний уровень</option>
                {nodes
                  .filter((p) => !p.archivedAt)
                  .map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
              </select>
            )}
          </Field>
          <button type="submit" disabled={!name.trim() || props.pending} className={btnPrimary}>
            Добавить
          </button>
        </form>
      )}
      <ul>{nodes.map((n) => row(n))}</ul>
    </section>
  );
}

export function CategoriesSettings() {
  const { company } = useOutletContext<CompanyOutletContext>();
  const categories = useCategories(company.id);
  const [localError, setLocalError] = useState<string | null>(null);
  const readOnly = company.archivedAt !== null;
  const base = `/companies/${company.id}/categories`;
  const action = useMutation<unknown, ApiError, Action>({
    mutationFn: (a) => api(a.path, { method: a.method, body: a.body }),
    // и после ошибки (например, 409 «список изменился») — свежее дерево
    onSettled: () => queryClient.invalidateQueries({ queryKey: ['categories', company.id] }),
  });
  const run = async (a: Action): Promise<boolean> => {
    setLocalError(null);
    action.reset();
    try {
      await action.mutateAsync(a);
      return true;
    } catch {
      return false;
    }
  };

  if (!categories.data) return <Pending queries={[categories]} />;
  const tree = categories.data;
  const serverError = action.error ? (action.error.fields ? Object.values(action.error.fields).join('. ') : action.error.message) : null;
  const error = localError ?? serverError;

  return (
    <section>
      <SettingsNav companyId={company.id} />
      <StaleNotice queries={[categories]} />
      <h1 className="mb-2 text-2xl font-bold">Категории</h1>
      <p className="mb-4 text-sm text-muted">
        Перетащите категорию мышью или используйте ↑/↓ и «Перенести в…». Вложенность — не больше двух уровней; системные категории остаются на
        верхнем уровне, но в них можно вкладывать.
      </p>
      {readOnly && <p className={noticeClass}>Компания в архиве — изменения недоступны.</p>}
      {error && (
        <p role="alert" className={alertClass}>
          {error}
        </p>
      )}
      {/* колонка не шире экрана: длинное название в «Перенести в…» не растягивает страницу телефона */}
      <div className="grid grid-cols-[minmax(0,1fr)] gap-6 lg:grid-cols-2">
        {(['income', 'expense'] as const).map((kind) => (
          <TreeSection
            key={kind}
            kind={kind}
            nodes={tree[kind]}
            base={base}
            readOnly={readOnly}
            pending={action.isPending}
            run={run}
            onLocalError={setLocalError}
          />
        ))}
      </div>
    </section>
  );
}
