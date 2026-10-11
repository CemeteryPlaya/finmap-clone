import { useRef, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router';
import { formatMoney, MONEY_SCREEN_BEFORE } from '../../shared/money';
import { companyInitials, filterCompanies, SEARCH_FROM } from '../lib/company-block';
import { switchCompanyPath } from '../lib/company-path';
import { focusHeadingSoon, isPlainLeftClick, pathOf } from '../lib/focus-heading';
import { useCompaniesSummary, type Company } from '../lib/queries';
import { CompanyEditDialog } from './CompanyEditDialog';
import { Drawer } from './Drawer';
import { btnPrimary, inputClass } from './ui';

/** Квадратный аватар с инициалами (свой цвет бренда, §1). display задаёт вызывающий: grid или hidden md:grid. */
export function CompanyAvatar({ name, className }: { name: string; className: string }) {
  return (
    <span aria-hidden="true" className={`shrink-0 place-items-center rounded-xl bg-income-soft font-bold text-income ${className}`}>
      {companyInitials(name)}
    </span>
  );
}

/**
 * Блок компании в шапке (§3.1 этапа 1.5): аватар, название и «Сменить компанию» — одна кнопка, открывает левую
 * панель «Компании» (§3.2). Доступное имя — «Сменить компанию: {название}».
 */
export function CompanyBlockButton({ current, companies }: { current: Company; companies: Company[] }) {
  const [open, setOpen] = useState(false);
  const navigated = useRef(false);
  return (
    <>
      <button
        type="button"
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label={`Сменить компанию: ${current.name}`}
        onClick={() => setOpen(true)}
        title={current.name}
        className="flex min-w-[10rem] max-w-xs items-center gap-3 rounded-xl px-2 py-1 text-left hover:bg-white/10 max-md:min-w-0"
      >
        <CompanyAvatar name={current.name} className="hidden h-10 w-10 text-sm md:grid" />
        <span className="min-w-0">
          <span className="block truncate font-semibold">{current.name}</span>
          <span className="block truncate text-xs text-white/60">Сменить компанию</span>
        </span>
      </button>
      <Drawer
        open={open}
        title="Компании"
        side="left"
        onClose={() => setOpen(false)}
        afterClose={() => {
          const handled = navigated.current;
          navigated.current = false;
          return handled;
        }}
      >
        <CompaniesList
          current={current}
          companies={companies}
          onDone={(withNavigation, target) => {
            // вызывается до navigate() и до перехода по ссылке: focusHeadingSoon запоминает исходную страницу
            navigated.current = withNavigation;
            if (withNavigation) focusHeadingSoon(target);
            setOpen(false);
          }}
        />
      </Drawer>
    </>
  );
}

function CompaniesList(props: { current: Company; companies: Company[]; onDone: (withNavigation: boolean, target?: string) => void }) {
  const navigate = useNavigate();
  const location = useLocation();
  const [query, setQuery] = useState('');
  const [editingId, setEditingId] = useState<number | null>(null);
  // итоги — при открытии панели (она монтирует список заново): свежие, без запросов на каждой странице
  const summary = useCompaniesSummary(true);
  const totals = new Map((summary.data ?? []).map((s) => [s.id, s.total]));
  // открытая архивная компания остаётся в списке (с пометкой), чтобы было видно, где пользователь
  const active = props.companies.filter((c) => !c.archivedAt || c.id === props.current.id);
  const shown = filterCompanies(active, query);

  const choose = (c: Company) => {
    // текущая компания — остаёмся там же (в том числе в настройках); другая — тот же раздел у неё
    if (c.id === props.current.id) return props.onDone(false);
    const to = switchCompanyPath(location.pathname, c.id);
    props.onDone(true, pathOf(to));
    navigate(to);
  };

  return (
    <div className="flex min-h-full flex-col">
      {active.length > SEARCH_FROM && (
        <input
          type="search"
          aria-label="Поиск"
          placeholder="Поиск"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            // первое Esc очищает запрос, закрывает панель только Esc при пустом поле
            if (e.key === 'Escape' && query !== '') {
              e.preventDefault();
              setQuery('');
            }
          }}
          className={`${inputClass} mb-4`}
        />
      )}
      {summary.isError && (
        <p className="mb-2 px-1 text-xs text-expense-strong">
          Не удалось загрузить итоги.{' '}
          <button type="button" className="underline" onClick={() => void summary.refetch()}>
            Повторить
          </button>
        </p>
      )}
      <p className="mb-2 px-1 text-xs font-semibold uppercase tracking-wide text-muted">Мои компании</p>
      <div className="flex-1">
        {shown.map((c) => {
          const t = totals.get(c.id);
          const isCurrent = c.id === props.current.id;
          return (
            <div key={c.id} className={`mb-1 flex items-center gap-1 rounded-xl ${isCurrent ? 'bg-field' : 'hover:bg-field'}`}>
              <button
                type="button"
                aria-current={isCurrent ? 'true' : undefined}
                onClick={() => choose(c)}
                className="flex min-w-0 flex-1 items-center gap-3 rounded-xl px-2 py-2 text-left"
              >
                <CompanyAvatar name={c.name} className="grid h-10 w-10 text-sm" />
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-semibold">
                    {c.name}
                    {isCurrent && (
                      <span aria-hidden="true" className="ml-1 text-income">
                        ✓
                      </span>
                    )}
                  </span>
                  {t ? (
                    <span className="block truncate text-xs tabular-nums text-muted">
                      {formatMoney(t.amount, t.currency, MONEY_SCREEN_BEFORE)}
                      {t.unavailable.length > 0 && ` · без ${t.unavailable.join(', ')}`}
                      {c.archivedAt && ' · в архиве'}
                    </span>
                  ) : (
                    <span className="block truncate text-xs text-muted">
                      {summary.isPending ? 'Загрузка…' : '—'}
                      {c.archivedAt && ' · в архиве'}
                    </span>
                  )}
                </span>
              </button>
              <button
                type="button"
                aria-label={`Изменить компанию «${c.name}»`}
                title="Изменить"
                onClick={() => setEditingId(c.id)}
                className="mr-1 grid h-9 w-9 shrink-0 place-items-center rounded-lg text-muted hover:bg-card hover:text-ink"
              >
                <span aria-hidden="true">✎</span>
              </button>
            </div>
          );
        })}
        {shown.length === 0 && <p className="px-1 text-sm text-muted">Ничего не найдено.</p>}
      </div>
      <div className="mt-4 grid gap-3 border-t border-field pt-4">
        <Link
          to="/companies/new"
          onClick={(e) => {
            if (isPlainLeftClick(e)) props.onDone(true, '/companies/new');
          }}
          className={`${btnPrimary} block text-center`}
        >
          Добавить компанию
        </Link>
        <Link
          to={`/c/${props.current.id}/settings/companies`}
          onClick={(e) => {
            if (isPlainLeftClick(e)) props.onDone(true, `/c/${props.current.id}/settings/companies`);
          }}
          className="text-center text-sm font-semibold text-muted underline hover:text-ink"
        >
          Все компании, в том числе архивные
        </Link>
      </div>
      {/* окно поверх панели — вложенный <dialog>: его Esc и close панель не закрывают (Drawer проверяет target) */}
      <CompanyEditDialog
        company={props.companies.find((c) => c.id === editingId) ?? null}
        currentId={props.current.id}
        onClose={() => setEditingId(null)}
      />
    </div>
  );
}
