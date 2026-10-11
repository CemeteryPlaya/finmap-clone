import { useEffect, useRef, useState } from 'react';
import { mergeSubsetOrder } from '../lib/order';
import { useAccounts, type Account, type Company } from '../lib/queries';
import { useReorder } from '../lib/settings-mutations';
import { AccountEditor } from './AccountEditor';
import { firstTabbable } from './focus-trap';
import { Modal } from './Modal';
import { Pending } from './QueryState';
import { SettingsList } from './SettingsList';
import { alertClass, btnSmall } from './ui';

type View = { kind: 'list' } | { kind: 'create' } | { kind: 'edit'; id: number };

/**
 * ✎ «Изменить счета» в «Моих счетах» (§7.6 этапа 1.5): окно «Счета» прямо над журналом — «Добавить счёт» и список
 * ☰ имя ✎ (порядок — тот же, что в разделе «Счета»). ✎ и «Добавить счёт» переключают это же окно на форму счёта
 * с «← Назад»; после сохранения, архива или удаления — снова список, фокус на ✎ счёта (или на «Добавить счёт»).
 */
export function AccountsQuickEdit({ company, open, onClose }: { company: Company; open: boolean; onClose: () => void }) {
  const accounts = useAccounts(company.id);
  const [view, setView] = useState<View>({ kind: 'list' });
  const [listError, setListError] = useState<string | null>(null);
  const body = useRef<HTMLDivElement>(null);
  const editor = useRef<HTMLDivElement>(null);
  /** Куда поставить фокус, когда окно снова покажет список. */
  const backTo = useRef<number | 'add' | null>(null);
  const reorder = useReorder<Account>(['accounts', company.id], `/companies/${company.id}/accounts/reorder`, setListError);

  // смена вида внутри открытого окна: фокус — на первое поле формы или обратно в список
  useEffect(() => {
    if (!open) return;
    if (view.kind !== 'list') {
      if (editor.current) firstTabbable(editor.current)?.focus();
      return;
    }
    const target = backTo.current;
    backTo.current = null;
    if (target === null || !body.current) return;
    const pencil = target === 'add' ? null : body.current.querySelector<HTMLElement>(`[data-edit-id="${target}"]`);
    (pencil ?? body.current.querySelector<HTMLElement>('[data-settings-add]'))?.focus();
  }, [view, open]);

  const toList = (focus: number | 'add') => {
    backTo.current = focus;
    setView({ kind: 'list' });
  };
  const close = () => {
    setView({ kind: 'list' });
    setListError(null);
    onClose();
  };
  const list = accounts.data ?? [];
  const account = view.kind === 'edit' ? (list.find((a) => a.id === view.id) ?? null) : null;
  const back: number | 'add' = view.kind === 'edit' ? view.id : 'add';
  const title = view.kind === 'list' ? 'Счета' : view.kind === 'create' ? 'Добавление нового счёта' : 'Счёт';

  return (
    <Modal open={open} title={title} onClose={close} className="max-w-lg">
      <div ref={body}>
        {view.kind === 'list' ? (
          !accounts.data ? (
            <Pending queries={[accounts]} />
          ) : (
            <>
              {listError && (
                <p role="alert" className={alertClass}>
                  {listError}
                </p>
              )}
              <SettingsList
                label="Список счетов"
                rows={list.map((a) => ({ id: a.id, name: a.name, secondary: a.currency, archived: a.archivedAt !== null }))}
                search={false}
                addLabel="Добавить счёт"
                onAdd={() => setView({ kind: 'create' })}
                onReorder={(group) =>
                  reorder.mutate(
                    mergeSubsetOrder(
                      list.map((a) => a.id),
                      group,
                    ),
                  )
                }
                onEdit={(row) => setView({ kind: 'edit', id: row.id })}
                empty="Счетов пока нет."
              />
            </>
          )
        ) : (
          <>
            <button type="button" onClick={() => toList(back)} className={`${btnSmall} mb-4`}>
              <span aria-hidden="true">←</span> Назад
            </button>
            <div ref={editor}>
              {view.kind === 'edit' && !account ? (
                <p className="text-muted">Счёт не найден — возможно, его удалили.</p>
              ) : (
                <AccountEditor key={view.kind === 'edit' ? view.id : 'new'} company={company} account={account} onDone={() => toList(back)} />
              )}
            </div>
          </>
        )}
      </div>
    </Modal>
  );
}
