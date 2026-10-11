import { useState } from 'react';
import { useOutletContext } from 'react-router';
import { AccountEditor } from '../../components/AccountEditor';
import { Modal } from '../../components/Modal';
import { Pending, StaleNotice } from '../../components/QueryState';
import { SettingsList } from '../../components/SettingsList';
import { alertClass, noticeClass } from '../../components/ui';
import { accountGroupKey, accountSecondary, panelOrder } from '../../lib/accounts-panel';
import { mergeSubsetOrder } from '../../lib/order';
import { useAccounts, useBalances, useProjects, type Account } from '../../lib/queries';
import { useReorder } from '../../lib/settings-mutations';
import type { CompanyOutletContext } from '../CompanyLayout';

/**
 * «Счета» на шаблоне списка (§7.4 этапа 1.5): без групп по клубам — клуб и баланс в сером тексте строки
 * (группы остаются в левой панели), но порядок — как в панели: «Общие», затем клубы; двигать можно только внутри клуба. «Добавить счёт» и ✎ — окно со счётом (`AccountEditor`).
 */
export function AccountsSettings() {
  const { company } = useOutletContext<CompanyOutletContext>();
  const accounts = useAccounts(company.id);
  const projects = useProjects(company.id);
  const balances = useBalances(company.id);
  const [editing, setEditing] = useState<number | 'new' | null>(null);
  const [listError, setListError] = useState<string | null>(null);
  const readOnly = company.archivedAt !== null;
  const reorder = useReorder<Account>(['accounts', company.id], `/companies/${company.id}/accounts/reorder`, setListError);

  if (!accounts.data || !projects.data) return <Pending queries={[accounts, projects]} />;
  const list = accounts.data;
  const projectList = projects.data;
  // правка по id: пока окно открыто, форма видит свежий счёт
  const editingAccount = typeof editing === 'number' ? (list.find((a) => a.id === editing) ?? null) : null;
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
        rows={panelOrder(list, projectList).map((a) => ({
          id: a.id,
          name: a.name,
          secondary: accountSecondary(a, projectList, balanceOf.get(a.id)) || undefined,
          archived: a.archivedAt !== null,
          group: accountGroupKey(a),
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
        onEdit={readOnly ? undefined : (row) => setEditing(row.id)}
        empty="Счетов пока нет. Счёт — это касса, карта или банковский счёт."
      />
      <Modal open={editing !== null} title={editing === 'new' ? 'Добавление нового счёта' : 'Счёт'} onClose={() => setEditing(null)} className="max-w-lg">
        {editing === 'new' && <AccountEditor key="new" company={company} account={null} onDone={() => setEditing(null)} />}
        {typeof editing === 'number' &&
          (editingAccount ? (
            <AccountEditor key={editing} company={company} account={editingAccount} onDone={() => setEditing(null)} />
          ) : (
            <p className="text-muted">Счёт не найден — возможно, его удалили.</p>
          ))}
      </Modal>
    </section>
  );
}
