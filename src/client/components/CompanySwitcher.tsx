import { useEffect, useId, useRef, useState, type KeyboardEvent } from 'react';
import { Link, useLocation, useNavigate } from 'react-router';
import { switchCompanyPath } from '../lib/company-path';
import { formatMoney } from '../../shared/money';
import { useCompaniesSummary, type Company } from '../lib/queries';

const companyItemClass =
  'flex w-full items-baseline justify-between gap-3 rounded-xl px-3 py-2 text-left text-sm hover:bg-field focus:bg-field focus:outline-none';
const itemClass = 'block w-full truncate rounded-xl px-3 py-2 text-left text-sm hover:bg-field focus:bg-field focus:outline-none';

/** Переключатель компаний: меню с клавиатурой (стрелки, Home/End, Esc), фокус возвращается на кнопку. */
export function CompanySwitcher({ current, companies }: { current: Company; companies: Company[] }) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const menuId = useId();
  const navigate = useNavigate();
  const location = useLocation();
  const active = companies.filter((c) => !c.archivedAt);
  // итоги — при открытии меню: свежие, без запросов на каждой странице
  const summary = useCompaniesSummary(open);
  const totals = new Map((summary.data ?? []).map((s) => [s.id, s.total]));

  const items = () => Array.from(menuRef.current?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? []);
  const focusItem = (index: number) => {
    const list = items();
    if (list.length > 0) list[(index + list.length) % list.length]!.focus();
  };
  const close = (returnFocus: boolean) => {
    setOpen(false);
    if (returnFocus) buttonRef.current?.focus();
  };

  // при открытии фокус — на текущей компании
  useEffect(() => {
    if (!open) return;
    const list = items();
    const i = list.findIndex((el) => el.dataset.current === 'true');
    focusItem(i >= 0 ? i : 0);
  }, [open]);

  // клик мимо меню закрывает его (фокус не перехватываем)
  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [open]);

  const onMenuKey = (e: KeyboardEvent<HTMLDivElement>) => {
    const list = items();
    const i = list.indexOf(document.activeElement as HTMLElement);
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      focusItem(i + 1);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      focusItem(i - 1);
    } else if (e.key === 'Home') {
      e.preventDefault();
      focusItem(0);
    } else if (e.key === 'End') {
      e.preventDefault();
      focusItem(list.length - 1);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      close(true);
    } else if (e.key === 'Tab') {
      setOpen(false);
    }
  };

  const choose = (c: Company) => {
    close(true);
    // текущая компания — остаёмся там же (в том числе в настройках); другая — тот же раздел у неё
    if (c.id !== current.id) navigate(switchCompanyPath(location.pathname, c.id));
  };

  return (
    // длинное название обрезается многоточием, когда шапке не хватает ширины (телефон)
    <div ref={rootRef} className="relative min-w-0 max-w-xs">
      <button
        ref={buttonRef}
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        onClick={() => setOpen((v) => !v)}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
            e.preventDefault();
            setOpen(true);
          }
        }}
        className="flex max-w-full items-center gap-2 rounded-xl bg-chrome-2 px-3 py-2 text-sm hover:bg-white/10"
      >
        {/* доступное имя содержит видимое название компании (WCAG 2.5.3 «Label in Name») */}
        <span className="sr-only">Сменить компанию: </span>
        <span className="truncate">{current.name}</span>
        <span aria-hidden="true">▾</span>
      </button>
      {open && (
        <div
          ref={menuRef}
          id={menuId}
          role="menu"
          aria-label="Компании"
          onKeyDown={onMenuKey}
          className="absolute left-0 z-20 mt-2 w-72 max-w-[calc(100vw-2rem)] rounded-2xl bg-card p-2 text-ink shadow-xl"
        >
          {active.map((c) => {
            const t = totals.get(c.id);
            return (
              <button
                key={c.id}
                role="menuitem"
                type="button"
                tabIndex={-1}
                data-current={c.id === current.id}
                aria-current={c.id === current.id ? 'true' : undefined}
                onClick={() => choose(c)}
                className={`${companyItemClass} ${c.id === current.id ? 'font-semibold' : ''}`}
              >
                <span className="truncate">{c.name}</span>
                {t && (
                  <span className="shrink-0 text-xs font-normal tabular-nums text-muted">
                    {formatMoney(t.amount, t.currency)}
                    {t.unavailable.length > 0 && ` · без ${t.unavailable.join(', ')}`}
                  </span>
                )}
              </button>
            );
          })}
          <div role="separator" className="my-1 border-t border-field" />
          <Link role="menuitem" tabIndex={-1} to="/companies/new" onClick={() => setOpen(false)} className={itemClass}>
            + Добавить компанию
          </Link>
          <Link role="menuitem" tabIndex={-1} to={`/c/${current.id}/settings/companies`} onClick={() => setOpen(false)} className={`${itemClass} text-muted`}>
            Все компании
          </Link>
        </div>
      )}
    </div>
  );
}
