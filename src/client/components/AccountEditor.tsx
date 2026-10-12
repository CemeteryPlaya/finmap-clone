import { useMutation } from '@tanstack/react-query';
import { api, type ApiError } from '../lib/api';
import { queryClient } from '../lib/query';
import { useProjects, type Account, type Company } from '../lib/queries';
import { useEntityActions } from '../lib/settings-mutations';
import { useHeldWhile } from '../lib/use-edited';
import { AccountForm, type AccountFormValues } from './AccountForm';
import { ArchivedNote, EntityActions } from './EntityActions';
import { Pending } from './QueryState';

function toBody(v: AccountFormValues) {
  return {
    name: v.name,
    currency: v.currency,
    projectId: v.projectId,
    startingBalance: v.startingBalance,
    ...(v.openedAt ? { openedAt: v.openedAt } : {}),
  };
}

/**
 * Содержимое окна счёта (§7.4, §7.6 этапа 1.5): без счёта — «Добавление нового счёта», со счётом — правка
 * с «В архив» / «Вернуть из архива» и «Удалить». Одно и то же в разделе «Счета», в «+» левой панели и в окне «Счета».
 * onDone — сохранено, переведено в архив, удалено или «Отмена». gone — счёта уже нет в списке (правка по id, R5 плана 1.5-4b).
 */
export function AccountEditor({ company, account: fresh, gone = false, onDone }: { company: Company; account: Account | null; gone?: boolean; onDone: () => void }) {
  const projects = useProjects(company.id);
  const base = `/companies/${company.id}/accounts`;
  // ['accounts', cid] обновляет и балансы (['accounts', cid, 'balances'])
  // и «Компании» (итог в меню компаний)
  const refresh = () => Promise.all([queryClient.invalidateQueries({ queryKey: ['accounts', company.id] }), queryClient.invalidateQueries({ queryKey: ['companies', 'summary'] })]);
  const save = useMutation<unknown, ApiError, AccountFormValues>({
    mutationFn: (v) => (fresh ? api(`${base}/${fresh.id}`, { method: 'PATCH', body: toBody(v) }) : api(base, { method: 'POST', body: toBody(v) })),
    onSuccess: async () => {
      await refresh();
      onDone();
    },
  });
  const actions = useEntityActions(fresh ? `${base}/${fresh.id}` : base, refresh, onDone);
  // во время своего запроса — счёт такой, каким был при нажатии (без вспышки «В архиве» и «не найден», R5)
  const busy = actions.pending || save.isPending;
  const account = useHeldWhile(fresh, busy);

  if (gone && !busy) return <p className="text-muted">Счёт не найден — возможно, его удалили.</p>;
  if (!projects.data) return <Pending queries={[projects]} />;
  return (
    <>
      {account?.archivedAt ? (
        <ArchivedNote />
      ) : (
        <AccountForm
          mode={account ? 'edit' : 'create'}
          initial={account ?? undefined}
          currencyLocked={account?.hasOperations}
          defaultCurrency={company.baseCurrency}
          projects={projects.data}
          pending={save.isPending}
          serverFields={save.error?.fields}
          serverError={save.error && !save.error.fields ? save.error.message : undefined}
          onSubmit={(v) => save.mutate(v)}
          onCancel={onDone}
        />
      )}
      {account && (
        <EntityActions
          archived={account.archivedAt !== null}
          onArchiveToggle={() => actions.toggleArchive(account.archivedAt !== null)}
          what={`счёт «${account.name}»`}
          onDelete={actions.remove}
          pending={actions.pending}
          error={actions.error}
        />
      )}
    </>
  );
}
