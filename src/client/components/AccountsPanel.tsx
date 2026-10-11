import { useEffect, useRef, useState, type MouseEvent } from 'react';
import { Link } from 'react-router';
import { formatMoney, MONEY_SCREEN_BEFORE } from '../../shared/money';
import { groupAccounts, showGroupTitles } from '../lib/accounts-panel';
import { focusHeadingSoon, isPlainLeftClick, pathOf } from '../lib/focus-heading';
import { refreshOperations } from '../lib/journal-mutations';
import { useIsMobile } from '../lib/media';
import { useAccounts, useBalances, useProjects, type Company } from '../lib/queries';
import { useSidebarCollapsed } from '../lib/sidebar';
import { AccountEditor } from './AccountEditor';
import { AccountsQuickEdit } from './AccountsQuickEdit';
import { CollapseButton } from './CollapseButton';
import { Drawer } from './Drawer';
import { PencilIcon, PlusIcon, RefreshIcon } from './icons';
import { Modal } from './Modal';

/** Иконка в строке «Мои счета»; на телефоне цель касания 44 px. */
const headIcon =
  'grid h-8 w-8 shrink-0 place-items-center rounded-lg text-muted hover:bg-field hover:text-ink disabled:opacity-50 focus-visible:outline-2 focus-visible:outline-focus max-md:size-11';

/**
 * Содержимое левой панели (§7, §7.6 этапа 1.5): «Всего на счетах» крупно; строка «Мои счета» с «+» (окно
 * «Добавление нового счёта» прямо над журналом), ✎ (окно «Счета») и ⟳ (§2.5); счета по клубам с балансами —
 * заголовки групп `h3`, только если групп больше одной. Без ролей listitem, status, alert, region: их ищут e2e
 * экранов настроек. onNavigate — переход по ссылке счёта (выезжающая панель на телефоне при этом закрывается).
 */
function AccountsSummary({ company, onNavigate }: { company: Company; onNavigate?: (target: string) => void }) {
  const accounts = useAccounts(company.id);
  const projects = useProjects(company.id);
  const balances = useBalances(company.id);
  const [dialog, setDialog] = useState<'add' | 'edit' | null>(null);
  const [refresh, setRefresh] = useState({ pending: false, failed: false, text: '' });
  const balanceOf = new Map((balances.data?.accounts ?? []).map((b) => [b.accountId, b.balance]));
  const groups = groupAccounts(accounts.data ?? [], projects.data ?? []);
  const titles = showGroupTitles(groups);
  const total = balances.data?.total;
  const failed = balances.error ?? accounts.error ?? projects.error;
  const writable = company.archivedAt === null;
  // только обычное нажатие левой кнопкой: Ctrl/Shift/средняя кнопка открывают ссылку отдельно, страница остаётся
  const click = (to: string) => (e: MouseEvent) => {
    if (onNavigate && isPlainLeftClick(e)) onNavigate(pathOf(to));
  };
  const runRefresh = async () => {
    setRefresh({ pending: true, failed: false, text: '' });
    try {
      await refreshOperations(company.id);
      setRefresh({ pending: false, failed: false, text: 'Данные обновлены' });
    } catch {
      setRefresh({ pending: false, failed: true, text: 'Не удалось обновить журнал' });
    }
  };
  const close = () => setDialog(null);

  return (
    <>
      <div className="mb-3 min-w-0">
        <p className="text-xs text-muted">Всего на счетах</p>
        <p className="truncate text-2xl font-bold tabular-nums">{total ? formatMoney(total.amount, total.currency, MONEY_SCREEN_BEFORE) : balances.error ? '—' : '…'}</p>
        {total?.unavailable.map((code) => (
          <p key={code} className="text-xs text-expense-strong">
            курс {code} недоступен
          </p>
        ))}
      </div>
      <div className="mb-2 flex items-center gap-1 border-t border-field pt-3">
        <h2 className="min-w-0 flex-1 truncate px-2 text-sm font-semibold">Мои счета</h2>
        {writable && (
          <button type="button" aria-label="Добавить счёт" title="Добавить счёт" onClick={() => setDialog('add')} className={headIcon}>
            <PlusIcon />
          </button>
        )}
        {writable && (
          <button type="button" aria-label="Изменить счета" title="Изменить счета" onClick={() => setDialog('edit')} className={headIcon}>
            <PencilIcon />
          </button>
        )}
        <button type="button" aria-label="Обновить" title="Обновить" disabled={refresh.pending} onClick={() => void runRefresh()} className={headIcon}>
          <RefreshIcon spinning={refresh.pending} />
        </button>
      </div>
      <p aria-live="polite" className={refresh.failed ? 'mb-2 px-2 text-xs text-expense-strong' : 'sr-only'}>
        {refresh.text}
      </p>
      {failed && (
        <p className="mb-2 text-xs text-expense-strong">
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
          {titles && <h3 className="mb-1 truncate px-2 text-xs font-semibold text-muted">{g.title}</h3>}
          {g.items.map((a) => {
            const balance = balanceOf.get(a.id);
            const to = `/c/${company.id}/log?account=${a.id}`;
            return (
              <Link key={a.id} to={to} onClick={click(to)} className="flex items-baseline justify-between gap-2 rounded-lg px-2 py-1.5 text-sm hover:bg-field">
                <span className="truncate">{a.name}</span>
                <span className={`shrink-0 tabular-nums ${balance !== undefined && balance < 0 ? 'text-expense-strong' : ''}`}>
                  {balance === undefined ? '…' : formatMoney(balance, a.currency, MONEY_SCREEN_BEFORE)}
                </span>
              </Link>
            );
          })}
        </div>
      ))}
      {accounts.data && groups.length === 0 && <p className="mb-3 px-2 text-sm text-muted">Счетов пока нет.</p>}
      {/* окна — вложенные <dialog>: на телефоне поверх выезжающей панели, её Esc и close они не трогают */}
      <Modal open={dialog === 'add'} title="Добавление нового счёта" onClose={close} className="max-w-lg">
        <AccountEditor company={company} account={null} onDone={close} />
      </Modal>
      <AccountsQuickEdit company={company} open={dialog === 'edit'} onClose={close} />
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
  const mobile = useIsMobile();
  return (
    <nav aria-label="Счета" className={`relative hidden shrink-0 self-start md:block ${collapsed ? 'h-24 w-3' : 'w-64 rounded-3xl bg-card p-4'}`}>
      <CollapseButton collapsed={collapsed} onToggle={toggle} collapseLabel="Свернуть панель счетов" expandLabel="Развернуть панель счетов" />
      {/* окна внутри скрытой на телефоне панели остались бы открытыми и невидимыми: key пересоздаёт содержимое и закрывает их */}
      {!collapsed && <AccountsSummary key={mobile ? 'mobile' : 'desktop'} company={company} />}
    </nav>
  );
}

/**
 * Счета на телефоне (§7 «Мобильная версия»): кнопка «Счета» в шапке, «Всего на счетах» и балансы выезжают
 * слева. Переход по счёту (фильтр журнала) закрывает панель, фокус — на `<h1>` страницы (§11 этапа 1.5).
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
