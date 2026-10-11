import { useMutation } from '@tanstack/react-query';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { useOutletContext, useSearchParams } from 'react-router';
import { ArchivedNote, EntityActions } from '../../components/EntityActions';
import { Field } from '../../components/Field';
import { BankIcon, PlusIcon } from '../../components/icons';
import { Modal } from '../../components/Modal';
import { Pending, StaleNotice } from '../../components/QueryState';
import { SettingsList } from '../../components/SettingsList';
import { SettingsSubmenu } from '../../components/SettingsSubmenu';
import { alertClass, btnIcon, btnPrimary, btnSecondary, inputClass, noticeClass } from '../../components/ui';
import { api, ApiError } from '../../lib/api';
import {
  CATEGORY_TABS,
  applyCategoryOrder,
  categoryReorderPlan,
  categoryRows,
  categoryShiftPlan,
  categoryTab,
  categoryTabInfo,
  parentOptions,
  type CategoryTab,
} from '../../lib/category-tabs';
import { planMove, type MovePlan } from '../../lib/category-moves';
import { queryClient } from '../../lib/query';
import { useCategories, type CategoryNode, type CategoryTree } from '../../lib/queries';
import { useEntityActions } from '../../lib/settings-mutations';
import type { CompanyOutletContext } from '../CompanyLayout';

const SYSTEM_HINT = 'Системная — не переименовывается и не удаляется';
const plusClass =
  'grid h-9 w-9 shrink-0 place-items-center rounded-full text-income-strong hover:bg-income-soft focus-visible:outline-2 focus-visible:outline-focus';

/** Окно категории: создание (на верхнем уровне или в родителе) или правка (по id — свежие данные из дерева). */
type CategoryDialog = { mode: 'new'; parent: CategoryNode | null } | { mode: 'edit'; id: number };

/** Текст ошибки: сообщения полей (сервер отдаёт отказ переноса как ids / parentId) или общее сообщение. */
const errorText = (e: ApiError) => (e.fields && Object.keys(e.fields).length > 0 ? Object.values(e.fields).join(' ') : e.message);

/**
 * Новый порядок соседей: POST …/categories/reorder. В кэше дерева порядок меняется сразу; отказ — прежний порядок и
 * onError(сообщение). Быстрые перестановки подряд не мешают друг другу: откат и обновление с сервера — после последней
 * (как useReorder у остальных списков). onError(null) — перед запросом.
 */
function useCategoryReorder(companyId: number, onError: (message: string | null) => void) {
  const queryKey = ['categories', companyId];
  const mutationKey = ['reorder', ...queryKey];
  // в onError/onSettled своя мутация ещё считается выполняющейся: «одна» — значит, других нет
  const lastOne = () => queryClient.isMutating({ mutationKey }) === 1;
  return useMutation<unknown, ApiError, MovePlan, { previous: CategoryTree | undefined }>({
    mutationKey,
    mutationFn: (plan) => api(`/companies/${companyId}/categories/reorder`, { method: 'POST', body: plan }),
    onMutate: async (plan) => {
      onError(null);
      await queryClient.cancelQueries({ queryKey });
      const previous = queryClient.getQueryData<CategoryTree>(queryKey);
      if (previous) queryClient.setQueryData<CategoryTree>(queryKey, applyCategoryOrder(previous, plan));
      return { previous };
    },
    onSuccess: () => {
      if (lastOne()) onError(null);
    },
    onError: (e, _plan, context) => {
      if (context?.previous && lastOne()) queryClient.setQueryData(queryKey, context.previous);
      onError(errorText(e));
    },
    onSettled: () => (lastOne() ? queryClient.invalidateQueries({ queryKey }) : undefined),
  });
}

const dialogTitle = (d: CategoryDialog) => (d.mode === 'edit' ? 'Категория' : d.parent ? 'Новая подкатегория' : 'Новая категория');

/**
 * «Категории» (§7.2 этапа 1.5): подменю «Системные / Мои × дохода / расхода» (`?tab=`), справа — шаблон списка:
 * верхний уровень полужирно, подкатегории с отступом, «+» — подкатегория, ✎ — окно «Категория»; у системных
 * вместо ✎ — «банк». Порядок — за ☰ среди соседей уровня (системные соседи не сдвигаются).
 */
export function CategoriesSettings() {
  const { company } = useOutletContext<CompanyOutletContext>();
  const categories = useCategories(company.id);
  const [params] = useSearchParams();
  const tab = categoryTab(params.get('tab'));
  const info = categoryTabInfo(tab);
  const [dialog, setDialog] = useState<CategoryDialog | null>(null);
  const [listError, setListError] = useState<string | null>(null);
  const readOnly = company.archivedAt !== null;
  const reorder = useCategoryReorder(company.id, setListError);
  // ошибка прежней вкладки на новой не нужна
  useEffect(() => setListError(null), [tab]);

  if (!categories.data) return <Pending queries={[categories]} />;
  const tree = categories.data;
  const editingNode = dialog?.mode === 'edit' ? (tree[info.kind].flatMap((n) => [n, ...n.children]).find((n) => n.id === dialog.id) ?? null) : null;

  return (
    <section>
      <StaleNotice queries={[categories]} />
      <h1 className="mb-4 text-2xl font-bold">Категории</h1>
      {readOnly && <p className={noticeClass}>Компания в архиве — изменения недоступны.</p>}
      {listError && (
        <p role="alert" className={alertClass}>
          {listError}
        </p>
      )}
      <div className="grid gap-6 md:grid-cols-[16rem_minmax(0,1fr)]">
        <SettingsSubmenu
          label="Виды категорий"
          param="tab"
          current={tab}
          items={CATEGORY_TABS.map((t) => ({ key: t.tab, label: t.label, icon: t.system ? ('bank' as const) : ('info' as const) }))}
        />
        <div className="min-w-0">
          <SettingsList
            key={tab}
            label={info.label}
            rows={categoryRows(tree, tab)}
            addLabel={readOnly || info.system ? null : 'Добавить категорию'}
            onAdd={() => setDialog({ mode: 'new', parent: null })}
            onReorder={
              readOnly
                ? undefined
                : (group) => {
                    const plan = categoryReorderPlan(tree, tab, group);
                    if (plan) reorder.mutate(plan);
                  }
            }
            onEdit={readOnly ? undefined : (row) => setDialog({ mode: 'edit', id: row.id })}
            canEdit={(row) => !row.system}
            strong={(row) => row.topLevel}
            actions={(row) => (
              <>
                {row.topLevel && !row.archived && !readOnly && (
                  <button
                    type="button"
                    aria-label={`Добавить подкатегорию в ${row.name}`}
                    title="Добавить подкатегорию"
                    onClick={() => setDialog({ mode: 'new', parent: row.node })}
                    className={plusClass}
                  >
                    <PlusIcon />
                  </button>
                )}
                {row.system && (
                  <span role="img" aria-label={SYSTEM_HINT} title={SYSTEM_HINT} className="grid h-9 w-9 shrink-0 place-items-center text-muted">
                    <BankIcon />
                  </span>
                )}
              </>
            )}
            empty={info.system ? 'Системных категорий этого вида нет.' : 'Своих категорий пока нет.'}
          />
        </div>
      </div>
      <Modal open={dialog !== null} title={dialog ? dialogTitle(dialog) : ''} onClose={() => setDialog(null)} className="max-w-lg">
        {dialog?.mode === 'new' && (
          <CategoryEditor
            key={`new-${dialog.parent?.id ?? 'top'}`}
            companyId={company.id}
            kind={info.kind}
            tree={tree}
            tab={tab}
            node={null}
            parent={dialog.parent}
            onDone={() => setDialog(null)}
          />
        )}
        {dialog?.mode === 'edit' &&
          (editingNode ? (
            <CategoryEditor
              key={dialog.id}
              companyId={company.id}
              kind={info.kind}
              tree={tree}
              tab={tab}
              node={editingNode}
              parent={null}
              onDone={() => setDialog(null)}
            />
          ) : (
            <p className="text-muted">Категория не найдена — возможно, её удалили.</p>
          ))}
      </Modal>
    </section>
  );
}

function CategoryEditor(props: {
  companyId: number;
  kind: 'income' | 'expense';
  tree: CategoryTree;
  tab: CategoryTab;
  node: CategoryNode | null;
  parent: CategoryNode | null;
  onDone: () => void;
}) {
  const { node, parent, onDone } = props;
  const base = `/companies/${props.companyId}/categories`;
  const level = props.tree[props.kind];
  const refresh = () => queryClient.invalidateQueries({ queryKey: ['categories', props.companyId] });
  const [name, setName] = useState(node?.name ?? '');
  const [parentValue, setParentValue] = useState(node?.parentId == null ? 'top' : String(node.parentId));
  const options = node ? parentOptions(level, node) : [];
  const save = useMutation<void, ApiError>({
    mutationFn: async () => {
      if (!node) {
        await api(base, { method: 'POST', body: { kind: props.kind, name, parentId: parent?.id ?? null } });
        return;
      }
      if (name.trim() !== node.name) await api(`${base}/${node.id}`, { method: 'PATCH', body: { name } });
      const target = parentValue === 'top' ? null : Number(parentValue);
      if (target !== node.parentId) {
        const plan = planMove(level, node.id, { parentId: target, beforeId: null });
        if (typeof plan === 'string') throw new ApiError(400, 'VALIDATION', plan);
        await api(`${base}/reorder`, { method: 'POST', body: plan });
      }
    },
    onSuccess: async () => {
      await refresh();
      onDone();
    },
    // переименование могло пройти, а перенос — нет: дерево перечитываем в любом случае
    onError: () => void refresh(),
  });
  const [shiftError, setShiftError] = useState<string | null>(null);
  const shift = useCategoryReorder(props.companyId, setShiftError);
  const upRef = useRef<HTMLButtonElement>(null);
  const downRef = useRef<HTMLButtonElement>(null);
  const actions = useEntityActions(node ? `${base}/${node.id}` : base, refresh, onDone);
  const fields = save.error?.fields ?? {};
  const submit = (e: FormEvent) => {
    e.preventDefault();
    save.mutate();
  };
  // среди видимых соседей вкладки: скрытые системные и архивные остаются на своих местах
  const up = node ? categoryShiftPlan(props.tree, props.tab, node.id, -1) : null;
  const down = node ? categoryShiftPlan(props.tree, props.tab, node.id, 1) : null;
  // дошли до края — стрелка гаснет (aria-disabled), фокус переходит на другую, а не падает на body
  useEffect(() => {
    if (!up && down && document.activeElement === upRef.current) downRef.current?.focus();
    if (!down && up && document.activeElement === downRef.current) upRef.current?.focus();
  }, [up, down]);
  const shiftBusy = shift.isPending;
  const arrow = (dir: 'up' | 'down', plan: MovePlan | null) => (
    <button
      ref={dir === 'up' ? upRef : downRef}
      type="button"
      aria-label={`${dir === 'up' ? 'Выше' : 'Ниже'}: ${node?.name ?? ''}`}
      title={dir === 'up' ? 'Выше' : 'Ниже'}
      aria-disabled={!plan || shiftBusy || undefined}
      onClick={() => {
        if (plan && !shiftBusy) shift.mutate(plan);
      }}
      className={`${btnIcon} aria-disabled:opacity-30`}
    >
      {dir === 'up' ? '↑' : '↓'}
    </button>
  );
  const otherFields = Object.entries(fields)
    .filter(([key]) => key !== 'name')
    .map(([, message]) => message);
  const saveAlert = save.error ? (otherFields.length > 0 ? otherFields.join(' ') : save.error.fields ? null : save.error.message) : null;

  return (
    <>
      {node?.archivedAt ? (
        <ArchivedNote />
      ) : (
        <form noValidate onSubmit={submit} className="grid gap-4">
          {parent && <p className="text-sm text-muted">Родитель: {parent.name}</p>}
          <Field label="Название" error={fields.name}>
            {(c) => <input {...c} value={name} onChange={(e) => setName(e.target.value)} className={inputClass} />}
          </Field>
          {node && (
            <Field label="Перенести в…" hint={options.length <= 1 ? (node.children.length > 0 ? 'Переносить некуда: у категории есть дочерние' : 'Переносить некуда') : undefined}>
              {(c) => (
                <select {...c} value={parentValue} disabled={options.length <= 1} onChange={(e) => setParentValue(e.target.value)} className={inputClass}>
                  {options.map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </select>
              )}
            </Field>
          )}
          {node && (
            <div className="flex items-center gap-2 text-sm text-muted">
              <span>Порядок:</span>
              <span className="inline-flex gap-1">
                {arrow('up', up)}
                {arrow('down', down)}
              </span>
            </div>
          )}
          {saveAlert || shiftError ? (
            <p role="alert" className={`${alertClass} mb-0`}>
              {saveAlert ?? shiftError}
            </p>
          ) : null}
          <div className="flex flex-wrap gap-2">
            <button type="submit" disabled={save.isPending || !name.trim()} className={btnPrimary}>
              Сохранить
            </button>
            <button type="button" onClick={onDone} className={btnSecondary}>
              Отмена
            </button>
          </div>
        </form>
      )}
      {node && (
        <EntityActions
          archived={node.archivedAt !== null}
          onArchiveToggle={() => actions.toggleArchive(node.archivedAt !== null)}
          what={`категорию «${node.name}»`}
          onDelete={actions.remove}
          pending={actions.pending}
          error={actions.error}
        />
      )}
    </>
  );
}
