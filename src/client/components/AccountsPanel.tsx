import { useState } from 'react';
import { Link } from 'react-router';
import { formatMoney } from '../../shared/money';
import { groupAccounts } from '../lib/accounts-panel';
import { savePreference, useAccounts, useBalances, usePreferences, useProjects, type Company } from '../lib/queries';
import { btnIcon, btnSmall } from './ui';

const PREF_KEY = 'sidebar.collapsed';

/**
 * Левая панель (§7): «Всего на счетах» в базовой валюте и счета по группам с балансами; сворачивается,
 * состояние — в настройках пользователя. Без ролей listitem, status, alert, region: их ищут e2e экранов настроек.
 * На узком экране скрыта (мобильная версия — шаг 7).
 */
export function AccountsPanel({ company }: { company: Company }) {
  const prefs = usePreferences();
  const accounts = useAccounts(company.id);
  const projects = useProjects(company.id);
  const balances = useBalances(company.id);
  // выбор виден сразу; сохраняется в фоне, сбой сохранения не мешает работе
  const [override, setOverride] = useState<boolean | null>(null);
  const collapsed = override ?? prefs.data?.[PREF_KEY] === true;
  const toggle = () => {
    const next = !collapsed;
    setOverride(next);
    savePreference(PREF_KEY, next).catch(() => undefined);
  };

  const balanceOf = new Map((balances.data?.accounts ?? []).map((b) => [b.accountId, b.balance]));
  const groups = groupAccounts(accounts.data ?? [], projects.data ?? []);
  const total = balances.data?.total;
  const failed = balances.error ?? accounts.error ?? projects.error;

  // кнопка свёртывания одна и стоит на одном месте в обоих состояниях: фокус не теряется при сворачивании.
  // Состояние передаёт меняющаяся подпись, aria-expanded не нужен.
  return (
    <nav aria-label="Счета" className={collapsed ? 'hidden shrink-0 md:block' : 'hidden w-64 shrink-0 self-start rounded-3xl bg-card p-4 md:block'}>
      <button
        type="button"
        aria-label={collapsed ? 'Развернуть панель счетов' : 'Свернуть панель счетов'}
        onClick={toggle}
        className={`${btnIcon} ${collapsed ? '' : 'float-right ml-2'}`}
      >
        <span aria-hidden="true">{collapsed ? '»' : '«'}</span>
      </button>
      {!collapsed && (
        <>
          <div className="mb-3 min-w-0">
            <p className="text-xs text-muted">Всего на счетах</p>
            <p className="truncate text-xl font-bold tabular-nums">{total ? formatMoney(total.amount, total.currency) : balances.error ? '—' : '…'}</p>
            {total?.unavailable.map((code) => (
              <p key={code} className="text-xs text-expense">
                курс {code} недоступен
              </p>
            ))}
          </div>
          {failed && (
            <p className="mb-2 text-xs text-expense">
              Не удалось загрузить счета.{' '}
              <button
                type="button"
                className="underline"
                onClick={() => {
                  void balances.refetch();
                  void accounts.refetch();
                  void projects.refetch();
                }}
              >
                Повторить
              </button>
            </p>
          )}
          {groups.map((g) => (
            <div key={g.key} className="mb-3">
              <p className="mb-1 truncate px-2 text-xs font-semibold text-muted">{g.title}</p>
              {g.items.map((a) => {
                const balance = balanceOf.get(a.id);
                return (
                  <Link
                    key={a.id}
                    to={`/c/${company.id}/log?account=${a.id}`}
                    className="flex items-baseline justify-between gap-2 rounded-lg px-2 py-1.5 text-sm hover:bg-field"
                  >
                    <span className="truncate">{a.name}</span>
                    <span className={`shrink-0 tabular-nums ${balance !== undefined && balance < 0 ? 'text-expense' : ''}`}>
                      {balance === undefined ? '…' : formatMoney(balance, a.currency)}
                    </span>
                  </Link>
                );
              })}
            </div>
          ))}
          {accounts.data && groups.length === 0 && <p className="mb-3 px-2 text-sm text-muted">Счетов пока нет.</p>}
          {!company.archivedAt && (
            <Link to={`/c/${company.id}/settings/accounts`} className={`${btnSmall} inline-block`}>
              + счёт
            </Link>
          )}
        </>
      )}
    </nav>
  );
}
