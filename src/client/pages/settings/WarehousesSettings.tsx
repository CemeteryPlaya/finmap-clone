import { useMutation } from '@tanstack/react-query';
import { useState, type FormEvent } from 'react';
import { useOutletContext } from 'react-router';
import { STOCK_GROUP_NAME_MAX, STOCK_WAREHOUSE_NAME_MAX } from '../../../shared/schemas/stock';
import { ArchivedNote, EntityActions } from '../../components/EntityActions';
import { Field } from '../../components/Field';
import { Modal } from '../../components/Modal';
import { Pending, StaleNotice } from '../../components/QueryState';
import { SettingsList } from '../../components/SettingsList';
import { alertClass, btnPrimary, btnSecondary, btnSmall, inputClass, noticeClass } from '../../components/ui';
import { api, type ApiError } from '../../lib/api';
import { useProjects } from '../../lib/queries';
import { invalidateStock, useStockGroups, useStockWarehouses } from '../../lib/stock';
import { defaultWarehouseName, projectsWithoutWarehouse } from '../../lib/stock-view';
import { useEntityActions } from '../../lib/settings-mutations';
import { useEditedItem, useHeldWhile, type EditingId } from '../../lib/use-edited';
import type { CompanyOutletContext } from '../CompanyLayout';

/** Окно названия склада или группы: правка и архив; новая группа — 'new'. */
function NameEditor(props: {
  companyId: number;
  kind: 'warehouses' | 'groups';
  /** Текущая запись; null — создание (только группа). */
  row: { id: number; name: string; archivedAt: string | null } | null;
  gone: boolean;
  label: string;
  what: string;
  max: number;
  onDone: () => void;
}) {
  const base = `/companies/${props.companyId}/stock/${props.kind}`;
  const refresh = () => invalidateStock(props.companyId);
  const [name, setName] = useState(props.row?.name ?? '');
  const save = useMutation<unknown, ApiError>({
    mutationFn: () => (props.row ? api(`${base}/${props.row.id}`, { method: 'PATCH', body: { name } }) : api(base, { method: 'POST', body: { name } })),
    onSuccess: async () => {
      await refresh();
      props.onDone();
    },
  });
  const actions = useEntityActions(props.row ? `${base}/${props.row.id}` : base, refresh, props.onDone);
  const busy = actions.pending || save.isPending;
  const row = useHeldWhile(props.row, busy);
  const submit = (e: FormEvent) => {
    e.preventDefault();
    save.mutate();
  };
  if (props.gone && !busy) return <p className="text-muted">Запись не найдена — возможно, её удалили.</p>;
  return (
    <>
      {row?.archivedAt ? (
        <ArchivedNote />
      ) : (
        <form noValidate onSubmit={submit} className="grid gap-4">
          <Field label={props.label} error={save.error?.fields?.name}>
            {(c) => (
              <input
                {...c}
                value={name}
                maxLength={props.max}
                onChange={(e) => {
                  setName(e.target.value);
                  save.reset();
                }}
                className={inputClass}
              />
            )}
          </Field>
          {save.error && !save.error.fields && (
            <p role="alert" className={`${alertClass} mb-0`}>
              {save.error.message}
            </p>
          )}
          <div className="flex flex-wrap gap-2">
            <button type="submit" disabled={save.isPending || !name.trim()} className={btnPrimary}>
              Сохранить
            </button>
            <button type="button" onClick={props.onDone} className={btnSecondary}>
              Отмена
            </button>
          </div>
        </form>
      )}
      {row && (
        <EntityActions
          archived={row.archivedAt !== null}
          onArchiveToggle={() => actions.toggleArchive(row.archivedAt !== null)}
          what={props.what}
          pending={actions.pending}
          error={actions.error}
        />
      )}
    </>
  );
}

/**
 * «Склады» (§4.5 спецификации «Склад»): склад у проекта — «Бар {проект}» одним нажатием — и группы товаров.
 * У проекта не больше одного склада; склад и группу можно переименовать и перевести в архив.
 */
export function WarehousesSettings() {
  const { company } = useOutletContext<CompanyOutletContext>();
  const warehouses = useStockWarehouses(company.id);
  const groups = useStockGroups(company.id);
  const projects = useProjects(company.id);
  const [editWarehouse, setEditWarehouse] = useState<EditingId>(null);
  const [editGroup, setEditGroup] = useState<EditingId>(null);
  const [createError, setCreateError] = useState<string | null>(null);
  const readOnly = company.archivedAt !== null;
  const editedWarehouse = useEditedItem(warehouses.data, editWarehouse);
  const editedGroup = useEditedItem(groups.data, editGroup);
  const create = useMutation<unknown, ApiError, { projectId: number; name: string }>({
    mutationFn: (body) => api(`/companies/${company.id}/stock/warehouses`, { method: 'POST', body }),
    onSuccess: () => invalidateStock(company.id),
    onError: (e) => setCreateError(e.fields?.projectId ?? e.message),
  });

  if (!warehouses.data || !groups.data || !projects.data) return <Pending queries={[warehouses, groups, projects]} />;
  const projectName = new Map(projects.data.map((p) => [p.id, p.name]));
  const free = projectsWithoutWarehouse(projects.data, warehouses.data);

  return (
    <section>
      <StaleNotice queries={[warehouses, groups, projects]} />
      <h1 className="mb-4 text-2xl font-bold">Склады</h1>
      {readOnly && <p className={noticeClass}>Компания в архиве — изменения недоступны.</p>}
      <p className="mb-4 text-sm text-muted">У каждого проекта — клуба или магазина — не больше одного склада.</p>
      {createError && (
        <p role="alert" className={alertClass}>
          {createError}
        </p>
      )}
      <SettingsList
        label="Склады"
        search={false}
        rows={warehouses.data.map((w) => ({ id: w.id, name: w.name, secondary: projectName.get(w.projectId), archived: w.archivedAt !== null }))}
        addLabel={null}
        onEdit={readOnly ? undefined : (row) => setEditWarehouse(row.id)}
        empty="Складов пока нет."
      />
      {!readOnly && free.length > 0 && (
        <div className="mt-4 grid gap-2">
          <h2 className="text-sm font-semibold">Проекты без склада</h2>
          {free.map((p) => (
            <div key={p.id} className="flex flex-wrap items-center justify-between gap-2 border-b border-field py-2">
              <span>{p.name}</span>
              <button
                type="button"
                disabled={create.isPending}
                onClick={() => {
                  setCreateError(null);
                  create.mutate({ projectId: p.id, name: defaultWarehouseName(p.name) });
                }}
                className={btnSmall}
              >
                Создать склад «{defaultWarehouseName(p.name)}»
              </button>
            </div>
          ))}
        </div>
      )}
      <h2 className="mt-8 mb-2 text-xl font-bold">Группы товаров</h2>
      <SettingsList
        label="Группы товаров"
        search={false}
        rows={groups.data.map((g) => ({ id: g.id, name: g.name, archived: g.archivedAt !== null }))}
        addLabel={readOnly ? null : 'Добавить группу'}
        onAdd={() => setEditGroup('new')}
        onEdit={readOnly ? undefined : (row) => setEditGroup(row.id)}
        empty="Групп пока нет: «Напитки», «Еда» и т. п."
      />
      <Modal open={editWarehouse !== null} title="Склад" onClose={() => setEditWarehouse(null)} className="max-w-lg">
        {editWarehouse !== null && (
          <NameEditor
            key={editWarehouse}
            companyId={company.id}
            kind="warehouses"
            row={editedWarehouse.item}
            gone={editedWarehouse.gone}
            label="Название склада"
            what="склад"
            max={STOCK_WAREHOUSE_NAME_MAX}
            onDone={() => setEditWarehouse(null)}
          />
        )}
      </Modal>
      <Modal open={editGroup !== null} title={editGroup === 'new' ? 'Новая группа' : 'Группа товаров'} onClose={() => setEditGroup(null)} className="max-w-lg">
        {editGroup !== null && (
          <NameEditor
            key={editGroup}
            companyId={company.id}
            kind="groups"
            row={editedGroup.item}
            gone={editedGroup.gone}
            label="Название группы"
            what="группу"
            max={STOCK_GROUP_NAME_MAX}
            onDone={() => setEditGroup(null)}
          />
        )}
      </Modal>
    </section>
  );
}
