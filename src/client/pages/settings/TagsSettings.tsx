import { useMutation } from '@tanstack/react-query';
import { useState } from 'react';
import { useOutletContext } from 'react-router';
import { foldCase } from '../../../shared/search';
import { cleanName } from '../../../shared/text';
import { ConfirmDelete } from '../../components/ConfirmDelete';
import { Field } from '../../components/Field';
import { Pending, StaleNotice } from '../../components/QueryState';
import { alertClass, btnPrimary, btnSecondary, btnSmall, inputClass, noticeClass } from '../../components/ui';
import { api, type ApiError } from '../../lib/api';
import { queryClient } from '../../lib/query';
import { useTags } from '../../lib/queries';
import type { CompanyOutletContext } from '../CompanyLayout';
import { SettingsNav } from './SettingsNav';

type Action = { path: string; method: 'POST' | 'DELETE' };

/** То же сравнение, что у сервера (name_key): без учёта регистра, «ё» и невидимых символов. */
const sameTag = (a: string, b: string) => foldCase(cleanName(a)) === foldCase(cleanName(b));

export function TagsSettings() {
  const { company } = useOutletContext<CompanyOutletContext>();
  const tags = useTags(company.id);
  const [name, setName] = useState('');
  const [renamingId, setRenamingId] = useState<number | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const [deletingId, setDeletingId] = useState<number | null>(null);
  const readOnly = company.archivedAt !== null;
  const base = `/companies/${company.id}/tags`;
  const invalidate = () => queryClient.invalidateQueries({ queryKey: ['tags', company.id] });

  const create = useMutation<unknown, ApiError, string>({
    mutationFn: (n) => api(base, { method: 'POST', body: { name: n } }),
    onSuccess: async () => {
      await invalidate();
      setName('');
    },
  });
  const rename = useMutation<unknown, ApiError, { id: number; name: string }>({
    mutationFn: (v) => api(`${base}/${v.id}`, { method: 'PATCH', body: { name: v.name } }),
    onSuccess: async () => {
      await invalidate();
      setRenamingId(null);
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
    rename.reset();
    action.reset();
  };

  if (!tags.data) return <Pending queries={[tags]} />;
  const list = tags.data;
  // имя совпало с архивным тегом — предлагаем вернуть его вместо дубля (§4.4)
  const archivedMatch = create.error?.code === 'ARCHIVED_DUPLICATE' ? list.find((t) => t.archivedAt && sameTag(t.name, name)) : undefined;
  const error = action.error ?? (rename.error && !rename.error.fields ? rename.error : null);

  return (
    <section>
      <SettingsNav companyId={company.id} />
      <StaleNotice queries={[tags]} />
      <h1 className="mb-4 text-2xl font-bold">Теги</h1>
      {readOnly && <p className={noticeClass}>Компания в архиве — изменения недоступны.</p>}
      {error && (
        <p role="alert" className={alertClass}>
          {error.message}
        </p>
      )}
      {!readOnly && (
        <form
          noValidate
          onSubmit={(e) => {
            e.preventDefault();
            resetMessages();
            create.mutate(name);
          }}
          className="mb-4 flex flex-wrap items-end gap-2"
        >
          <Field label="Новый тег" error={archivedMatch ? undefined : create.error?.fields?.name} className="min-w-64 flex-1">
            {(c) => (
              <input
                {...c}
                value={name}
                onChange={(e) => {
                  setName(e.target.value);
                  create.reset();
                }}
                className={inputClass}
              />
            )}
          </Field>
          <button type="submit" disabled={!name.trim() || create.isPending} className={btnPrimary}>
            Добавить
          </button>
        </form>
      )}
      {archivedMatch && (
        <div role="alert" className="mb-4 flex flex-wrap items-center gap-3 rounded-xl bg-field px-4 py-3 text-sm">
          <span>Тег «{archivedMatch.name}» есть в архиве.</span>
          <button
            type="button"
            className={btnPrimary}
            onClick={() =>
              action.mutate(
                { path: `${base}/${archivedMatch.id}/unarchive`, method: 'POST' },
                {
                  onSuccess: () => {
                    create.reset();
                    setName('');
                  },
                },
              )
            }
          >
            Вернуть из архива
          </button>
        </div>
      )}
      {list.length === 0 && <p className="text-muted">Тегов пока нет. Теги помогают отмечать операции поперёк статей и проектов.</p>}
      <ul className="space-y-2">
        {list.map((t) => (
          <li key={t.id} className={`rounded-2xl border border-field px-4 py-3 ${t.archivedAt ? 'opacity-60' : ''}`}>
            {renamingId === t.id ? (
              <form
                noValidate
                onSubmit={(e) => {
                  e.preventDefault();
                  rename.mutate({ id: t.id, name: renameValue });
                }}
                className="flex flex-wrap items-start gap-2"
              >
                <Field label={`Новое название тега «${t.name}»`} error={rename.error?.fields?.name} className="min-w-64 flex-1">
                  {(c) => <input {...c} autoFocus value={renameValue} onChange={(e) => setRenameValue(e.target.value)} className={inputClass} />}
                </Field>
                <div className="flex gap-2 md:mt-6">
                  <button type="submit" disabled={!renameValue.trim() || rename.isPending} className={btnPrimary}>
                    Сохранить
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setRenamingId(null);
                      rename.reset();
                    }}
                    className={btnSecondary}
                  >
                    Отмена
                  </button>
                </div>
              </form>
            ) : (
              <div className="flex flex-wrap items-center justify-between gap-3">
                <span className="font-semibold">
                  {t.name}
                  {t.archivedAt && <span className="ml-2 rounded-full bg-field px-2 py-0.5 text-xs font-normal text-muted">В архиве</span>}
                </span>
                {!readOnly &&
                  (deletingId === t.id ? (
                    <ConfirmDelete
                      what={`тег «${t.name}»`}
                      pending={action.isPending}
                      onConfirm={() => action.mutate({ path: `${base}/${t.id}`, method: 'DELETE' })}
                      onCancel={() => setDeletingId(null)}
                    />
                  ) : (
                    <span className="flex flex-wrap gap-2">
                      {!t.archivedAt && (
                        <button
                          type="button"
                          onClick={() => {
                            resetMessages();
                            setRenameValue(t.name);
                            setRenamingId(t.id);
                          }}
                          className={btnSmall}
                        >
                          Переименовать
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={() => {
                          resetMessages();
                          action.mutate({ path: `${base}/${t.id}/${t.archivedAt ? 'unarchive' : 'archive'}`, method: 'POST' });
                        }}
                        className={btnSmall}
                      >
                        {t.archivedAt ? 'Вернуть из архива' : 'В архив'}
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          resetMessages();
                          setDeletingId(t.id);
                        }}
                        className={btnSmall}
                      >
                        Удалить
                      </button>
                    </span>
                  ))}
              </div>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}
