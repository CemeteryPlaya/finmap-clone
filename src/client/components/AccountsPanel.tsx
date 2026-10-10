import { useEffect, useRef, useState, type MouseEvent } from 'react';
import { Link } from 'react-router';
import { formatMoney, MONEY_SCREEN_BEFORE } from '../../shared/money';
import { groupAccounts } from '../lib/accounts-panel';
import { focusHeadingSoon, isPlainLeftClick, pathOf } from '../lib/focus-heading';
import { useIsMobile } from '../lib/media';
import { useAccounts, useBalances, useProjects, type Company } from '../lib/queries';
import { useSidebarCollapsed } from '../lib/sidebar';
import { CollapseButton } from './CollapseButton';
import { Drawer } from './Drawer';
import { btnSmall } from './ui';

/**
 * Содержимое левой панели (§7): «Всего на счетах» в базовой валюте и счета по группам с балансами, «+ счёт».
 * Без ролей listitem, status, alert, region: их ищут e2e экранов настроек. onNavigate — переход по ссылке
 * (выезжающая панель на телефоне при этом закрывается).
 */
function AccountsSummary({ company, onNavigate, onAdd }: { company: Company; onNavigate?: (target: string) => void; onAdd?: (target: string) => void }) {
  const accounts = useAccounts(company.id);
  const projects = useProjects(company.id);
  const balances = useBalances(company.id);
  const balanceOf = new Map((balances.data?.accounts ?? []).map((b) => [b.accountId, b.balance]));
  const groups = groupAccounts(accounts.data ?? [], projects.data ?? []);
  const total = balances.data?.total;
  const failed = balances.error ?? accounts.error ?? projects.error;
  // только обычное нажатие левой кнопкой: Ctrl/Shift/средняя кнопка открывают ссылку отдельно, страница остаётся
  const click = (handler: ((target: string) => void) | undefined, to: string) => (e: MouseEvent) => {
    if (handler && isPlainLeftClick(e)) handler(pathOf(to));
  };

  return (
    <>
      <div className="mb-3 min-w-0">
        <p className="text-xs text-muted">Всего на счетах</p>
        <p className="truncate text-xl font-bold tabular-nums">{total ? formatMoney(total.amount, total.currency, MONEY_SCREEN_BEFORE) : balances.error ? '—' : '…'}</p>
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
                onClick={click(onNavigate, `/c/${company.id}/log?account=${a.id}`)}
                className="flex items-baseline justify-between gap-2 rounded-lg px-2 py-1.5 text-sm hover:bg-field"
              >
                <span className="truncate">{a.name}</span>
                <span className={`shrink-0 tabular-nums ${balance !== undefined && balance < 0 ? 'text-expense' : ''}`}>
                  {balance === undefined ? '…' : formatMoney(balance, a.currency, MONEY_SCREEN_BEFORE)}
                </span>
              </Link>
            );
          })}
        </div>
      ))}
      {accounts.data && groups.length === 0 && <p className="mb-3 px-2 text-sm text-muted">Счетов пока нет.</p>}
      {!company.archivedAt && (
        <Link to={`/c/${company.id}/settings/accounts`} onClick={click(onAdd ?? onNavigate, `/c/${company.id}/settings/accounts`)} className={`${btnSmall} inline-block`}>
          + счёт
        </Link>
      )}
    </>
  );
}

/**
 * Левая панель на компьютере (§7): сворачивается круглой кнопкой на правой границе (§3.6 этапа 1.5),
 * состояние — общая с меню настроек настройка пользователя. На узком экране скрыта — там счета выезжают
 * слева по кнопке в шапке (AccountsDrawerButton).
 */
export function AccountsPanel({ company }: { company: Company }) {
  const { collapsed, toggle } = useSidebarCollapsed();
  // «+ счёт» уводит из журнала в настройки: панель заменяется меню настроек, нажатая ссылка исчезает — фокус на h1
  return (
    <nav aria-label="Счета" className={`relative hidden shrink-0 self-start md:block ${collapsed ? 'h-24 w-3' : 'w-64 rounded-3xl bg-card p-4'}`}>
      <CollapseButton collapsed={collapsed} onToggle={toggle} collapseLabel="Свернуть панель счетов" expandLabel="Развернуть панель счетов" />
      {!collapsed && <AccountsSummary company={company} onAdd={(target) => focusHeadingSoon(target)} />}
    </nav>
  );
}

/**
 * Счета на телефоне (§7 «Мобильная версия»): кнопка «Счета» в шапке, «Всего на счетах» и балансы выезжают
 * слева. Переход по счёту (фильтр журнала) или к «+ счёт» закрывает панель, фокус — на `<h1>` страницы (§11 этапа 1.5).
 */
export function AccountsDrawerButton({ company }: { company: Company }) {
  const [open, setOpen] = useState(false);
  const navigated = useRef(false);
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
      <Drawer
        open={open}
        title="Счета"
        side="left"
        onClose={() => setOpen(false)}
        afterClose={() => {
          const handled = navigated.current;
          navigated.current = false;
          return handled;
        }}
      >
        <AccountsSummary
          company={company}
          onNavigate={(target) => {
            navigated.current = true;
            focusHeadingSoon(target);
            setOpen(false);
          }}
        />
      </Drawer>
    </>
  );
}
