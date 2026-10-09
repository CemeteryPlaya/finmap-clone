import { useEffect, useState } from 'react';
import { Link } from 'react-router';
import { formatMoney } from '../../shared/money';
import { groupAccounts } from '../lib/accounts-panel';
import { useIsMobile } from '../lib/media';
import { savePreference, useAccounts, useBalances, usePreferences, useProjects, type Company } from '../lib/queries';
import { Drawer } from './Drawer';
import { btnIcon, btnSmall } from './ui';

const PREF_KEY = 'sidebar.collapsed';

/**
 * Содержимое левой панели (§7): «Всего на счетах» в базовой валюте и счета по группам с балансами, «+ счёт».
 * Без ролей listitem, status, alert, region: их ищут e2e экранов настроек. onNavigate — переход по ссылке
 * (выезжающая панель на телефоне при этом закрывается).
 */
function AccountsSummary({ company, onNavigate }: { company: Company; onNavigate?: () => void }) {
  const accounts = useAccounts(company.id);
  const projects = useProjects(company.id);
  const balances = useBalances(company.id);
  const balanceOf = new Map((balances.data?.accounts ?? []).map((b) => [b.accountId, b.balance]));
  const groups = groupAccounts(accounts.data ?? [], projects.data ?? []);
  const total = balances.data?.total;
  const failed = balances.error ?? accounts.error ?? projects.error;

  return (
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
                onClick={onNavigate}
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
        <Link to={`/c/${company.id}/settings/accounts`} onClick={onNavigate} className={`${btnSmall} inline-block`}>
          + счёт
        </Link>
      )}
    </>
  );
}

/**
 * Левая панель на компьютере (§7): сворачивается, состояние — в настройках пользователя.
 * На узком экране скрыта — там счета выезжают слева по кнопке в шапке (AccountsDrawerButton).
 */
export function AccountsPanel({ company }: { company: Company }) {
  const prefs = usePreferences();
  // выбор виден сразу; сохраняется в фоне, сбой сохранения не мешает работе
  const [override, setOverride] = useState<boolean | null>(null);
  const collapsed = override ?? prefs.data?.[PREF_KEY] === true;
  const toggle = () => {
    const next = !collapsed;
    setOverride(next);
    savePreference(PREF_KEY, next).catch(() => undefined);
  };

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
      {!collapsed && <AccountsSummary company={company} />}
    </nav>
  );
}

/**
 * Счета на телефоне (§7 «Мобильная версия»): кнопка «Счета» в шапке, «Всего на счетах» и балансы выезжают
 * слева. Переход по счёту (фильтр журнала) или к «+ счёт» закрывает панель.
 */
export function AccountsDrawerButton({ company }: { company: Company }) {
  const [open, setOpen] = useState(false);
  const mobile = useIsMobile();
  // окно стало шире телефона — на месте левая панель, выезжающая не нужна
  useEffect(() => {
    if (!mobile) setOpen(false);
  }, [mobile]);
  return (
    <>
      <button
        type="button"
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => setOpen(true)}
        className="shrink-0 rounded-xl bg-chrome-2 px-3 py-2 text-sm hover:bg-white/10 md:hidden"
      >
        Счета
      </button>
      <Drawer open={open} title="Счета" side="left" onClose={() => setOpen(false)}>
        <AccountsSummary company={company} onNavigate={() => setOpen(false)} />
      </Drawer>
    </>
  );
}
