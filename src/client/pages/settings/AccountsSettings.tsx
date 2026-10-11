import { useState } from 'react';
import { useOutletContext } from 'react-router';
import { AccountEditor } from '../../components/AccountEditor';
import { Modal } from '../../components/Modal';
import { Pending, StaleNotice } from '../../components/QueryState';
import { SettingsList } from '../../components/SettingsList';
import { alertClass, noticeClass } from '../../components/ui';
import { accountSecondary } from '../../lib/accounts-panel';
import { mergeSubsetOrder } from '../../lib/order';
import { useAccounts, useBalances, useProjects, type Account } from '../../lib/queries';
import { useReorder } from '../../lib/settings-mutations';
import type { CompanyOutletContext } from '../CompanyLayout';

/**
 * «Счета» на шаблоне списка (§7.4 этапа 1.5): без групп по клубам — клуб и баланс в сером тексте строки
 * (группы остаются в левой панели). «Добавить счёт» и ✎ — окно со счётом (`AccountEditor`).
 */
export function AccountsSettings() {
  const { company } = useOutletContext<CompanyOutletContext>();
  const accounts = useAccounts(company.id);
  const projects = useProjects(company.id);
  const balances = useBalances(company.id);
  const [editing, setEditing] = useState<Account | 'new' | null>(null);
  const [listError, setListError] = useState<string | null>(null);
  const readOnly = company.archivedAt !== null;
  const reorder = useReorder<Account>(['accounts', company.id], `/companies/${company.id}/accounts/reorder`, setListError);

  if (!accounts.data || !projects.data) return <Pending queries={[accounts, projects]} />;
  const list = accounts.data;
  const projectList = projects.data;
  const balanceOf = new Map((balances.data?.accounts ?? []).map((b) => [b.accountId, b.balance]));

  return (
    <section>
      <StaleNotice queries={[accounts, projects]} />
      <h1 className="mb-4 text-2xl font-bold">Счета</h1>
      {readOnly && <p className={noticeClass}>Компания в архиве — изменения недоступны.</p>}
      {listError && (
        <p role="alert" className={alertClass}>
          {listError}
        </p>
      )}
      <SettingsList
        label="Счета"
        rows={list.map((a) => ({
          id: a.id,
          name: a.name,
          secondary: accountSecondary(a, projectList, balanceOf.get(a.id)) || undefined,
          archived: a.archivedAt !== null,
        }))}
        addLabel={readOnly ? null : 'Добавить счёт'}
        onAdd={() => setEditing('new')}
        onReorder={
          readOnly
            ? undefined
            : (group) =>
                reorder.mutate(
                  mergeSubsetOrder(
                    list.map((a) => a.id),
                    group,
                  ),
                )
        }
        onEdit={readOnly ? undefined : (row) => setEditing(list.find((a) => a.id === row.id) ?? null)}
        empty="Счетов пока нет. Счёт — это касса, карта или банковский счёт."
      />
      <Modal open={editing !== null} title={editing === 'new' ? 'Добавление нового счёта' : 'Счёт'} onClose={() => setEditing(null)} className="max-w-lg">
        {editing !== null && (
          <AccountEditor key={editing === 'new' ? 'new' : editing.id} company={company} account={editing === 'new' ? null : editing} onDone={() => setEditing(null)} />
        )}
      </Modal>
    </section>
  );
}
