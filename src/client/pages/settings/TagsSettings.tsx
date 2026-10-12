import { useMutation } from '@tanstack/react-query';
import { useState, type FormEvent } from 'react';
import { useOutletContext } from 'react-router';
import { foldCase } from '../../../shared/search';
import { cleanName } from '../../../shared/text';
import { ArchivedNote, EntityActions } from '../../components/EntityActions';
import { Field } from '../../components/Field';
import { Modal } from '../../components/Modal';
import { Pending, StaleNotice } from '../../components/QueryState';
import { SettingsList } from '../../components/SettingsList';
import { alertClass, btnPrimary, btnSecondary, inputClass, noticeClass } from '../../components/ui';
import { api, type ApiError } from '../../lib/api';
import { mergeSubsetOrder } from '../../lib/order';
import { queryClient } from '../../lib/query';
import { useTags, type Tag } from '../../lib/queries';
import { useEntityActions, useReorder } from '../../lib/settings-mutations';
import { useEditedItem, useHeldWhile, type EditingId } from '../../lib/use-edited';
import type { CompanyOutletContext } from '../CompanyLayout';

/** То же сравнение, что у сервера (name_key): без учёта регистра, «ё» и невидимых символов. */
const sameTag = (a: string, b: string) => foldCase(cleanName(a)) === foldCase(cleanName(b));

/** Окно тега: 'new' — «Новый тег», id — «Тег» (свежие данные из списка), null — закрыто. */
type Editing = EditingId;

/** «Теги» на шаблоне списка (§7.1, §7.4 этапа 1.5): создание и правка — в окне, порядок — за ☰. */
export function TagsSettings() {
  const { company } = useOutletContext<CompanyOutletContext>();
  const tags = useTags(company.id);
  const [editing, setEditing] = useState<Editing>(null);
  const [listError, setListError] = useState<string | null>(null);
  const readOnly = company.archivedAt !== null;
  const reorder = useReorder<Tag>(['tags', company.id], `/companies/${company.id}/tags/reorder`, setListError);
  const edited = useEditedItem(tags.data, editing);

  if (!tags.data) return <Pending queries={[tags]} />;
  const list = tags.data;

  return (
    <section>
      <StaleNotice queries={[tags]} />
      <h1 className="mb-4 text-2xl font-bold">Теги</h1>
      {readOnly && <p className={noticeClass}>Компания в архиве — изменения недоступны.</p>}
      {listError && (
        <p role="alert" className={alertClass}>
          {listError}
        </p>
      )}
      <SettingsList
        label="Теги"
        rows={list.map((t) => ({ id: t.id, name: t.name, archived: t.archivedAt !== null }))}
        addLabel={readOnly ? null : 'Добавить тег'}
        onAdd={() => setEditing('new')}
        onReorder={
          readOnly
            ? undefined
            : (group) =>
                reorder.mutate(
                  mergeSubsetOrder(
                    list.map((t) => t.id),
                    group,
                  ),
                )
        }
        onEdit={readOnly ? undefined : (row) => setEditing(row.id)}
        empty="Тегов пока нет. Теги помогают отмечать операции поперёк категорий и проектов."
      />
      <Modal open={editing !== null} title={editing === 'new' ? 'Новый тег' : 'Тег'} onClose={() => setEditing(null)} className="max-w-lg">
        {editing !== null && <TagEditor key={editing} companyId={company.id} tag={edited.item} gone={edited.gone} tags={list} onDone={() => setEditing(null)} />}
      </Modal>
    </section>
  );
}

function TagEditor({ companyId, tag: fresh, gone, tags, onDone }: { companyId: number; tag: Tag | null; gone: boolean; tags: Tag[]; onDone: () => void }) {
  const base = `/companies/${companyId}/tags`;
  const refresh = () => queryClient.invalidateQueries({ queryKey: ['tags', companyId] });
  const [name, setName] = useState(fresh?.name ?? '');
  const save = useMutation<unknown, ApiError>({
    mutationFn: () => (fresh ? api(`${base}/${fresh.id}`, { method: 'PATCH', body: { name } }) : api(base, { method: 'POST', body: { name } })),
    onSuccess: async () => {
      await refresh();
      onDone();
    },
  });
  const restore = useMutation<unknown, ApiError, number>({
    mutationFn: (id) => api(`${base}/${id}/unarchive`, { method: 'POST' }),
    onSuccess: async () => {
      await refresh();
      onDone();
    },
  });
  const actions = useEntityActions(fresh ? `${base}/${fresh.id}` : base, refresh, onDone);
  // во время своего запроса — тег такой, каким был при нажатии (без вспышки «В архиве» и «не найден», R5)
  const busy = actions.pending || save.isPending || restore.isPending;
  const tag = useHeldWhile(fresh, busy);
  // имя совпало с архивным тегом — предлагаем вернуть его вместо дубля (§4.4)
  const archivedMatch = save.error?.code === 'ARCHIVED_DUPLICATE' ? tags.find((t) => t.archivedAt && sameTag(t.name, name)) : undefined;
  const submit = (e: FormEvent) => {
    e.preventDefault();
    save.mutate();
  };

  if (gone && !busy) return <p className="text-muted">Тег не найден — возможно, его удалили.</p>;
  return (
    <>
      {tag?.archivedAt ? (
        <ArchivedNote />
      ) : (
        <form noValidate onSubmit={submit} className="grid gap-4">
          <Field label="Название тега" error={archivedMatch ? undefined : save.error?.fields?.name}>
            {(c) => (
              <input
                {...c}
                value={name}
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
          {archivedMatch && (
            <div role="alert" className="flex flex-wrap items-center gap-3 rounded-xl bg-field px-4 py-3 text-sm">
              <span>Тег «{archivedMatch.name}» есть в архиве.</span>
              <button type="button" disabled={restore.isPending} onClick={() => restore.mutate(archivedMatch.id)} className={btnPrimary}>
                Вернуть из архива
              </button>
            </div>
          )}
          {restore.error && (
            <p role="alert" className={`${alertClass} mb-0`}>
              {restore.error.message}
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
      {tag && (
        <EntityActions
          archived={tag.archivedAt !== null}
          onArchiveToggle={() => actions.toggleArchive(tag.archivedAt !== null)}
          what={`тег «${tag.name}»`}
          onDelete={actions.remove}
          pending={actions.pending}
          error={actions.error}
        />
      )}
    </>
  );
}
