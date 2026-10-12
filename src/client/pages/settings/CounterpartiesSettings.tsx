import { useMutation } from '@tanstack/react-query';
import { useEffect, useId, useState, type FormEvent } from 'react';
import { useOutletContext, useSearchParams } from 'react-router';
import { COUNTERPARTY_TYPE_SINGULAR } from '../../../shared/counterparties';
import type { CounterpartyType } from '../../../shared/system-categories';
import { ArchivedNote, EntityActions } from '../../components/EntityActions';
import { Field } from '../../components/Field';
import { Modal } from '../../components/Modal';
import { Pending, StaleNotice } from '../../components/QueryState';
import { SettingsList } from '../../components/SettingsList';
import { SettingsSubmenu } from '../../components/SettingsSubmenu';
import { alertClass, btnPrimary, btnSecondary, inputClass, noticeClass } from '../../components/ui';
import { api, type ApiError } from '../../lib/api';
import { COUNTERPARTY_TABS, counterpartyTab, counterpartyTabInfo, tabOfType, type CounterpartyTab } from '../../lib/counterparty-tabs';
import { mergeSubsetOrder } from '../../lib/order';
import { queryClient } from '../../lib/query';
import { useCounterparties, type Counterparty } from '../../lib/queries';
import { useEntityActions, useReorder } from '../../lib/settings-mutations';
import { useEditedItem, useHeldWhile } from '../../lib/use-edited';
import type { CompanyOutletContext } from '../CompanyLayout';

/** Окно контрагента: 'new' — создание во вкладке, id — правка (свежие данные из списка), null — закрыто. */
type Editing = number | 'new' | null;

/**
 * «Контрагенты» (§7.3 этапа 1.5): подменю типов слева в порядке Finmap (`?type=`), справа — шаблон списка.
 * «Мои контрагенты» — клиенты и поставщики вместе, тип серым в строке; вкладки «Все» нет.
 */
export function CounterpartiesSettings() {
  const { company } = useOutletContext<CompanyOutletContext>();
  const counterparties = useCounterparties(company.id);
  const [params] = useSearchParams();
  const tab = counterpartyTab(params.get('type'));
  const info = counterpartyTabInfo(tab);
  const [editing, setEditing] = useState<Editing>(null);
  const [listError, setListError] = useState<string | null>(null);
  const readOnly = company.archivedAt !== null;
  const reorder = useReorder<Counterparty>(['counterparties', company.id], `/companies/${company.id}/counterparties/reorder`, setListError);

  // ошибка перестановки относится к вкладке, где она случилась
  useEffect(() => setListError(null), [tab]);
  const edited = useEditedItem(counterparties.data, editing);

  if (!counterparties.data) return <Pending queries={[counterparties]} />;
  const all = counterparties.data;
  const inTab = all.filter((c) => tabOfType(c.type) === tab);

  return (
    <section>
      <StaleNotice queries={[counterparties]} />
      <h1 className="mb-4 text-2xl font-bold">Контрагенты</h1>
      {readOnly && <p className={noticeClass}>Компания в архиве — изменения недоступны.</p>}
      {listError && (
        <p role="alert" className={alertClass}>
          {listError}
        </p>
      )}
      <div className="grid gap-6 md:grid-cols-[14rem_minmax(0,1fr)]">
        <SettingsSubmenu
          label="Типы контрагентов"
          param="type"
          current={tab}
          items={COUNTERPARTY_TABS.map((t) => ({
            key: t.tab,
            label: t.label,
            icon: t.tab === 'my' ? ('info' as const) : ('bank' as const),
            count: all.filter((c) => tabOfType(c.type) === t.tab).length,
          }))}
        />
        <div className="min-w-0">
          <SettingsList
            key={tab}
            label={info.label}
            rows={inTab.map((c) => ({
              id: c.id,
              name: c.name,
              secondary: [tab === 'my' ? COUNTERPARTY_TYPE_SINGULAR[c.type] : null, c.comment].filter((s): s is string => !!s).join(' · ') || undefined,
              searchText: c.comment ?? undefined,
              archived: c.archivedAt !== null,
            }))}
            addLabel={readOnly ? null : info.add}
            onAdd={() => setEditing('new')}
            onReorder={
              readOnly
                ? undefined
                : (group) =>
                    reorder.mutate(
                      mergeSubsetOrder(
                        all.map((c) => c.id),
                        group,
                      ),
                    )
            }
            onEdit={readOnly ? undefined : (row) => setEditing(row.id)}
            empty="Контрагентов этого типа пока нет."
          />
        </div>
      </div>
      <Modal open={editing !== null} title={editing === 'new' ? info.createTitle : info.editTitle} onClose={() => setEditing(null)} className="max-w-lg">
        {/* новое — со своим ключом на каждую вкладку: «Назад» в браузере меняет вкладку и тип создаваемого */}
        {editing === 'new' && <CounterpartyEditor key={`new-${tab}`} companyId={company.id} tab={tab} counterparty={null} gone={false} onDone={() => setEditing(null)} />}
        {typeof editing === 'number' && (
          <CounterpartyEditor key={editing} companyId={company.id} tab={tab} counterparty={edited.item} gone={edited.gone} onDone={() => setEditing(null)} />
        )}
      </Modal>
    </section>
  );
}

function CounterpartyEditor(props: { companyId: number; tab: CounterpartyTab; counterparty: Counterparty | null; gone: boolean; onDone: () => void }) {
  const { onDone } = props;
  const fresh = props.counterparty;
  const base = `/companies/${props.companyId}/counterparties`;
  const refresh = () => queryClient.invalidateQueries({ queryKey: ['counterparties', props.companyId] });
  const [name, setName] = useState(fresh?.name ?? '');
  const [comment, setComment] = useState(fresh?.comment ?? '');
  const [type, setType] = useState<CounterpartyType>(fresh?.type ?? (props.tab === 'my' ? 'client' : props.tab));
  const radioName = useId();
  const save = useMutation<unknown, ApiError>({
    mutationFn: () => {
      const body = { type, name, comment };
      return fresh ? api(`${base}/${fresh.id}`, { method: 'PATCH', body }) : api(base, { method: 'POST', body });
    },
    onSuccess: async () => {
      await refresh();
      onDone();
    },
  });
  const actions = useEntityActions(fresh ? `${base}/${fresh.id}` : base, refresh, onDone);
  // во время своего запроса — контрагент такой, каким был при нажатии (R5)
  const busy = actions.pending || save.isPending;
  const counterparty = useHeldWhile(fresh, busy);
  const fields = save.error?.fields ?? {};
  const submit = (e: FormEvent) => {
    e.preventDefault();
    save.mutate();
  };

  if (props.gone && !busy) return <p className="text-muted">Контрагент не найден — возможно, его удалили.</p>;
  return (
    <>
      {counterparty?.archivedAt ? (
        <ArchivedNote />
      ) : (
        <form noValidate onSubmit={submit} className="grid gap-4">
          {props.tab === 'my' && (
            <fieldset>
              <legend className="mb-1 text-sm text-muted">Тип</legend>
              <div className="flex flex-wrap gap-4">
                {(['client', 'supplier'] as const).map((t) => (
                  <label key={t} className="flex items-center gap-2">
                    <input type="radio" name={radioName} value={t} checked={type === t} onChange={() => setType(t)} />
                    {COUNTERPARTY_TYPE_SINGULAR[t]}
                  </label>
                ))}
              </div>
              {fields.type && <span className="mt-1 block text-sm text-expense-strong">{fields.type}</span>}
            </fieldset>
          )}
          <Field label="Название" error={fields.name}>
            {(c) => <input {...c} value={name} onChange={(e) => setName(e.target.value)} className={inputClass} />}
          </Field>
          <Field label="Комментарий" error={fields.comment}>
            {(c) => <input {...c} value={comment} onChange={(e) => setComment(e.target.value)} className={inputClass} />}
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
            <button type="button" onClick={onDone} className={btnSecondary}>
              Отмена
            </button>
          </div>
        </form>
      )}
      {counterparty && (
        <EntityActions
          archived={counterparty.archivedAt !== null}
          onArchiveToggle={() => actions.toggleArchive(counterparty.archivedAt !== null)}
          what={`контрагента «${counterparty.name}»`}
          onDelete={actions.remove}
          pending={actions.pending}
          error={actions.error}
        />
      )}
    </>
  );
}
