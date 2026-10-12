import { useId } from 'react';
import { Link, NavLink } from 'react-router';
import { CollapseButton } from '../../components/CollapseButton';
import { focusHeadingSoon, isPlainLeftClick, pathOf } from '../../lib/focus-heading';
import { journalBackHref, readLastJournal } from '../../lib/last-journal';
import type { Company } from '../../lib/queries';
import { ACCOUNT_GROUP_LABEL, settingsGroups } from '../../lib/settings-sections';
import { useSidebarCollapsed } from '../../lib/sidebar';

const sidebarLink = ({ isActive }: { isActive: boolean }) =>
  `block truncate rounded-xl px-3 py-2 text-sm ${isActive ? 'bg-field font-semibold text-ink' : 'text-muted hover:bg-field hover:text-ink'}`;
/** Строка экрана «Настройки» на телефоне (§8.6 этапа 1.5): во всю ширину, 48 px, «›» справа. */
const listLink = 'flex min-h-12 items-center justify-between gap-3 rounded-xl px-3 text-base text-ink hover:bg-field focus-visible:outline-2 focus-visible:outline-focus';

/**
 * Навигация зоны настроек (§4.1–4.2, §8.6 этапа 1.5) — разделы по группам.
 * `sidebar` — слева вместо панели счетов (компьютер), с «← Назад к журналу»; сворачивается той же настройкой, что панель
 * счетов (§3.6). `list` — экран «Настройки» на телефоне: разделы строками во всю ширину; в журнал ведёт вкладка «Журнал»
 * нижней панели. Без ролей listitem, status, alert, region: их ищут e2e экранов настроек.
 */
export function SettingsNav({ company, variant }: { company: Company; variant: 'sidebar' | 'list' }) {
  const { collapsed, toggle } = useSidebarCollapsed();
  if (variant === 'list') {
    return (
      <nav aria-label="Разделы настроек">
        <SettingsGroups companyId={company.id} companyName={company.name} list />
      </nav>
    );
  }
  const back = journalBackHref(company.id, readLastJournal(company.id));
  return (
    <nav aria-label="Разделы настроек" className={`relative hidden shrink-0 self-start md:block ${collapsed ? 'h-36 w-3' : 'w-64 rounded-3xl bg-card p-4'}`}>
      <CollapseButton collapsed={collapsed} onToggle={toggle} collapseLabel="Свернуть меню настроек" expandLabel="Развернуть меню настроек" />
      {collapsed && <BackLink to={back} compact />}
      {!collapsed && (
        <>
          <BackLink to={back} />
          <SettingsGroups companyId={company.id} companyName={company.name} list={false} />
        </>
      )}
    </nav>
  );
}

/**
 * «← Настройки» над разделом на телефоне (§8.6 этапа 1.5): назад к экрану списка разделов, фокус — на его `<h1>`.
 * На компьютере не видна — разделы в меню слева.
 */
export function SettingsListLink({ companyId }: { companyId: number }) {
  const to = `/c/${companyId}/settings`;
  return (
    <Link
      to={to}
      onClick={(e) => {
        if (isPlainLeftClick(e)) focusHeadingSoon(to);
      }}
      className="mb-3 inline-flex min-h-11 items-center gap-2 rounded-xl bg-field px-4 text-sm font-medium text-ink hover:brightness-95 md:hidden"
    >
      <span aria-hidden="true">←</span> Настройки
    </Link>
  );
}

/**
 * «← Назад к журналу»: ссылка исчезает вместе с меню настроек, поэтому фокус переносится на h1 журнала.
 * compact — только стрелка в свёрнутой полосе (под кнопкой сворачивания).
 */
function BackLink({ to, compact }: { to: string; compact?: boolean }) {
  const label = 'Назад к журналу';
  return (
    <Link
      to={to}
      onClick={(e) => {
        if (isPlainLeftClick(e)) focusHeadingSoon(pathOf(to));
      }}
      {...(compact ? { 'aria-label': label, title: label } : {})}
      className={
        compact
          ? '-right-4 absolute top-[4.75rem] z-10 grid h-8 w-8 place-items-center rounded-full border border-field bg-card text-ink shadow hover:bg-field'
          : 'mb-3 inline-flex items-center gap-2 rounded-xl bg-field px-4 py-2 text-sm font-medium text-ink hover:brightness-95'
      }
    >
      <span aria-hidden="true">←</span>
      {!compact && ` ${label}`}
    </Link>
  );
}

/** Группы разделов: в меню слева — NavLink с текущим разделом; на экране списка — строки со стрелкой и фокусом на `<h1>` раздела. */
function SettingsGroups(props: { companyId: number; companyName: string; list: boolean }) {
  const id = useId();
  return (
    <>
      {settingsGroups(props.companyName).map((g) => {
        const titleId = `${id}-${g.key}`;
        return (
          // настоящая группа с именем: программа чтения называет её при входе (итоги 1.5-1b №1); не список — listitem ищут e2e разделов
          <div
            key={g.key}
            role="group"
            {...(g.title ? { 'aria-labelledby': titleId } : { 'aria-label': ACCOUNT_GROUP_LABEL })}
            className={g.title ? 'mt-3 border-t border-field pt-3' : ''}
          >
            {g.title && (
              <p id={titleId} className="mb-1 truncate px-3 text-xs font-semibold uppercase tracking-wide text-muted">
                {g.title}
              </p>
            )}
            <div className={props.list ? 'grid' : 'grid gap-0.5'}>
              {g.items.map((s) => {
                const to = `/c/${props.companyId}/settings/${s.path}`;
                return props.list ? (
                  <Link
                    key={s.path}
                    to={to}
                    onClick={(e) => {
                      if (isPlainLeftClick(e)) focusHeadingSoon(pathOf(to));
                    }}
                    className={listLink}
                  >
                    <span className="min-w-0 truncate">{s.label}</span>
                    <span aria-hidden="true" className="shrink-0 text-muted">
                      ›
                    </span>
                  </Link>
                ) : (
                  <NavLink key={s.path} to={to} className={sidebarLink}>
                    {s.label}
                  </NavLink>
                );
              })}
            </div>
          </div>
        );
      })}
    </>
  );
}
