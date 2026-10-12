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
import { useEntityActions, useReorder } from '../../lib/settings-mutations';
import { useEditedItem, useHeldWhile } from '../../lib/use-edited';
import type { CompanyOutletContext } from '../CompanyLayout';

const SYSTEM_HINT = 'Системная — не переименовывается и не удаляется';
const plusClass =
  'grid h-9 w-9 shrink-0 place-items-center rounded-full text-income-strong hover:bg-income-soft focus-visible:outline-2 focus-visible:outline-focus max-md:size-11';

/**
 * Окно категории: создание (на верхнем уровне или в родителе — по его id, сам родитель берётся из свежего дерева)
 * или правка (по id — свежие данные из дерева).
 */
type CategoryDialog = { mode: 'new'; parentId: number | null } | { mode: 'edit'; id: number };

const dialogTitle = (d: CategoryDialog) => (d.mode === 'edit' ? 'Категория' : d.parentId !== null ? 'Новая подкатегория' : 'Новая категория');

const NOT_FOUND = 'Категория не найдена — возможно, её удалили.';

/** Перестановка соседей дерева категорий — общий useReorder (R7 плана 1.5-4b): тело — план, в кэше — дерево. */
function useCategoryReorder(companyId: number, onError: (message: string | null) => void) {
  return useReorder<CategoryTree, MovePlan>(['categories', companyId], `/companies/${companyId}/categories/reorder`, onError, {
    body: (plan) => plan,
    apply: applyCategoryOrder,
  });
}

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
  const nodes = categories.data?.[info.kind].flatMap((n) => [n, ...n.children]);
  const edited = useEditedItem(nodes, dialog?.mode === 'edit' ? dialog.id : null);

  if (!categories.data) return <Pending queries={[categories]} />;
  const tree = categories.data;
  // «+» по id: родитель — из свежего дерева; если его удалили или перевели в архив, пока окно открыто, — окно скажет об этом
  const newParent = dialog?.mode === 'new' && dialog.parentId !== null ? (tree[info.kind].find((n) => n.id === dialog.parentId) ?? null) : null;

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
            onAdd={() => setDialog({ mode: 'new', parentId: null })}
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
                    onClick={() => setDialog({ mode: 'new', parentId: row.id })}
                    className={plusClass}
                  >
                    <PlusIcon />
                  </button>
                )}
                {row.system && (
                  <span role="img" aria-label={SYSTEM_HINT} title={SYSTEM_HINT} className="grid h-9 w-9 shrink-0 place-items-center text-muted max-md:size-11">
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
            key={`new-${dialog.parentId ?? 'top'}`}
            companyId={company.id}
            kind={info.kind}
            tree={tree}
            tab={tab}
            node={null}
            gone={dialog.parentId !== null && newParent === null}
            parent={newParent}
            onDone={() => setDialog(null)}
          />
        )}
        {dialog?.mode === 'edit' && (
          <CategoryEditor
            key={dialog.id}
            companyId={company.id}
            kind={info.kind}
            tree={tree}
            tab={tab}
            node={edited.item}
            gone={edited.gone}
            parent={null}
            onDone={() => setDialog(null)}
          />
        )}
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
  /** Категории (или родителя новой подкатегории) уже нет в дереве: «не найдена», когда своего запроса в пути нет (R5). */
  gone: boolean;
  parent: CategoryNode | null;
  onDone: () => void;
}) {
  const { parent, onDone } = props;
  const base = `/companies/${props.companyId}/categories`;
  const level = props.tree[props.kind];
  const refresh = () => queryClient.invalidateQueries({ queryKey: ['categories', props.companyId] });
  const [name, setName] = useState(props.node?.name ?? '');
  const [parentValue, setParentValue] = useState(props.node?.parentId == null ? 'top' : String(props.node.parentId));
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
  const actions = useEntityActions(props.node ? `${base}/${props.node.id}` : base, refresh, onDone);
  // во время своего запроса — категория такой, какой была при нажатии (без вспышки «В архиве» и «не найдена»)
  const busy = actions.pending || save.isPending;
  const node = useHeldWhile(props.node, busy);
  const options = node ? parentOptions(level, node) : [];
  const fields = save.error?.fields ?? {};
  const submit = (e: FormEvent) => {
    e.preventDefault();
    save.mutate();
  };
  // среди видимых соседей вкладки: скрытые системные и архивные остаются на своих местах
  const up = node ? categoryShiftPlan(props.tree, props.tab, node.id, -1) : null;
  const down = node ? categoryShiftPlan(props.tree, props.tab, node.id, 1) : null;
  // дошли до края — стрелка гаснет (aria-disabled), фокус переходит на другую, а не падает на body;
  // зависимости — есть ли стрелка: план — новый объект на каждой отрисовке
  const canUp = up !== null;
  const canDown = down !== null;
  useEffect(() => {
    if (!canUp && canDown && document.activeElement === upRef.current) downRef.current?.focus();
    if (!canDown && canUp && document.activeElement === downRef.current) upRef.current?.focus();
  }, [canUp, canDown]);
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

  if (props.gone && !busy) return <p className="text-muted">{NOT_FOUND}</p>;
  // родителя новой подкатегории перевели в архив, пока окно открыто
  if (!node && parent?.archivedAt && !busy) return <p className="text-muted">Категория «{parent.name}» в архиве — сначала верните её из архива.</p>;
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
