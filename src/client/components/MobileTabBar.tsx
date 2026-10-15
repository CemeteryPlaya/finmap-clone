import { useEffect, useState, type MouseEvent } from 'react';
import { Link, NavLink, useLocation, useMatch } from 'react-router';
import { focusHeadingSoon, isPlainLeftClick, pathOf } from '../lib/focus-heading';
import { journalBackHref, readLastJournal } from '../lib/last-journal';
import { useIsMobile } from '../lib/media';
import type { Company } from '../lib/queries';
import { HistoryPanel } from './HistoryDrawer';
import { useOpenImport } from './import/ImportPanel';
import { Popover } from './Popover';

/** Вкладка нижней панели: 56 px; текущая (`aria-current="page"`) — тёмным текстом и чертой сверху, как в Finmap. */
const tabBase =
  'relative flex h-14 w-full items-center justify-center text-xs font-semibold focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-focus';
const tabClass = `${tabBase} text-muted hover:text-ink aria-[current=page]:text-ink aria-[current=page]:before:absolute aria-[current=page]:before:top-0 aria-[current=page]:before:h-0.5 aria-[current=page]:before:w-8 aria-[current=page]:before:rounded-full aria-[current=page]:before:bg-ink`;
/** Внешний вид текущей вкладки без aria-current: «Ещё» в зоне настроек (кнопка меню, не ссылка). */
const currentClass = 'text-ink before:absolute before:top-0 before:h-0.5 before:w-8 before:rounded-full before:bg-ink';
/** Пункт меню «Ещё»: цель касания 48 px. */
const itemClass =
  'flex min-h-12 w-full items-center rounded-xl px-3 text-left text-base font-medium text-ink hover:bg-field focus-visible:outline-2 focus-visible:outline-focus';

/**
 * Нижняя панель вкладок на телефоне (§8.3 этапа 1.5): «Журнал» и «Ещё» — меню вверх с «Склад», «Пользователи», «Настройки»
 * (экран списка разделов, §8.6), «История действий» (панель §3.4) и «Импорт из Excel» (панель импорта на весь экран,
 * §5.1 спецификации импорта; в архивной компании пункта нет). «Аналитика» появится на этапе 2 между ними.
 * «Журнал» в самом журнале — текущий адрес; из настроек — последний адрес журнала с фильтром. Переход по ссылке ставит
 * фокус на `<h1>` новой страницы; закрытие истории возвращает фокус на «Ещё». На компьютере панели нет.
 */
export function MobileTabBar({ company }: { company: Company }) {
  const [history, setHistory] = useState(false);
  const mobile = useIsMobile();
  // окно стало шире телефона — панель вкладок скрыта, а открытая история держала бы страницу недоступной
  useEffect(() => {
    if (!mobile) setHistory(false);
  }, [mobile]);
  // в архивную компанию импорт запрещён (§1.2 спецификации импорта): пункта нет. Панель — в раскладке компании
  const openImport = useOpenImport();
  const location = useLocation();
  const onJournal = useMatch('/c/:companyId/log') !== null;
  const inSettings = useMatch('/c/:companyId/settings/*') !== null;
  const inStock = useMatch('/c/:companyId/stock/*') !== null;
  // запомненный адрес журнала обновляется после отрисовки страницы — в самом журнале берём текущий
  const journal = onJournal ? `${location.pathname}${location.search}` : journalBackHref(company.id, readLastJournal(company.id));
  const stock = `/c/${company.id}/stock`;
  const users = `/c/${company.id}/settings/users`;
  const settings = `/c/${company.id}/settings`;
  // обычное нажатие: фокус на <h1> новой страницы, меню закрывается без возврата фокуса на «Ещё»
  const go = (to: string, close?: (returnFocus?: boolean) => void) => (e: MouseEvent) => {
    if (!isPlainLeftClick(e)) return;
    focusHeadingSoon(pathOf(to));
    close?.(false);
  };
  return (
    <>
      <nav
        aria-label="Разделы"
        data-tab-bar=""
        // высота панели — h-14 (tabClass) + safe-area: тот же запас снизу у mainCardClass (ui.ts) и UndoToast; менять вместе
        className="fixed inset-x-0 bottom-0 z-20 grid grid-cols-2 border-t border-field bg-card pr-[env(safe-area-inset-right)] pb-[env(safe-area-inset-bottom)] pl-[env(safe-area-inset-left)] text-ink shadow-[0_-4px_16px_rgb(0_0_0/0.08)] md:hidden"
      >
        <NavLink to={journal} onClick={go(journal)} className={tabClass}>
          Журнал
        </NavLink>
        <Popover key={mobile ? 'phone' : 'wide'} label="Ещё" align="right" buttonClassName={inSettings || inStock ? `${tabBase} ${currentClass}` : tabClass} panelClassName="w-60">
          {(close) => (
            <ul className="flex flex-col">
              <li>
                <Link to={stock} onClick={go(stock, close)} className={itemClass}>
                  Склад
                </Link>
              </li>
              <li>
                <Link to={users} onClick={go(users, close)} className={itemClass}>
                  Пользователи
                </Link>
              </li>
              <li>
                <Link to={settings} onClick={go(settings, close)} className={itemClass}>
                  Настройки
                </Link>
              </li>
              <li>
                <button
                  type="button"
                  onClick={() => {
                    // фокус сначала на «Ещё»: панель истории запомнит его как кнопку открытия
                    close(true);
                    setHistory(true);
                  }}
                  className={itemClass}
                >
                  История действий
                </button>
              </li>
              {openImport && (
                <li>
                  <button
                    type="button"
                    onClick={() => {
                      // фокус сначала на «Ещё»: панель импорта вернёт его туда при закрытии (§5.1 спецификации импорта)
                      close(true);
                      openImport();
                    }}
                    className={itemClass}
                  >
                    Импорт из Excel
                  </button>
                </li>
              )}
            </ul>
          )}
        </Popover>
      </nav>
      {/* вне <nav>: при скрытой (md:hidden) панели вкладок окно истории не должно оказаться внутри display:none */}
      <HistoryPanel company={company} open={history} onClose={() => setHistory(false)} />
    </>
  );
}
