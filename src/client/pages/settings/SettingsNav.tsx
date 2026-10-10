import { Link, NavLink } from 'react-router';
import { CollapseButton } from '../../components/CollapseButton';
import { focusHeadingSoon, isPlainLeftClick, pathOf } from '../../lib/focus-heading';
import { journalBackHref, readLastJournal } from '../../lib/last-journal';
import type { Company } from '../../lib/queries';
import { settingsGroups } from '../../lib/settings-sections';
import { useSidebarCollapsed } from '../../lib/sidebar';

const sidebarLink = ({ isActive }: { isActive: boolean }) =>
  `block truncate rounded-xl px-3 py-2 text-sm ${isActive ? 'bg-field font-semibold text-ink' : 'text-muted hover:bg-field hover:text-ink'}`;
const inlineLink = ({ isActive }: { isActive: boolean }) =>
  `rounded-xl px-3 py-1.5 text-sm ${isActive ? 'bg-field font-semibold text-ink' : 'text-muted hover:text-ink'}`;

/**
 * Навигация зоны настроек (§4.1–4.2 этапа 1.5): «← Назад к журналу» и разделы по группам.
 * `sidebar` — слева вместо панели счетов (компьютер), сворачивается той же настройкой, что панель счетов (§3.6);
 * `inline` — строкой над разделом на телефоне (список разделов отдельным экраном — план 1.5-5).
 * Без ролей listitem, status, alert, region: их ищут e2e экранов настроек.
 */
export function SettingsNav({ company, variant }: { company: Company; variant: 'sidebar' | 'inline' }) {
  const back = journalBackHref(company.id, readLastJournal(company.id));
  const { collapsed, toggle } = useSidebarCollapsed();
  if (variant === 'inline') {
    return (
      <nav aria-label="Разделы настроек" className="mb-6 md:hidden">
        <SettingsNavBody companyId={company.id} companyName={company.name} back={back} sidebar={false} />
      </nav>
    );
  }
  return (
    <nav aria-label="Разделы настроек" className={`relative hidden shrink-0 self-start md:block ${collapsed ? 'h-36 w-3' : 'w-64 rounded-3xl bg-card p-4'}`}>
      <CollapseButton collapsed={collapsed} onToggle={toggle} collapseLabel="Свернуть меню настроек" expandLabel="Развернуть меню настроек" />
      {collapsed && <BackLink to={back} compact />}
      {!collapsed && <SettingsNavBody companyId={company.id} companyName={company.name} back={back} sidebar />}
    </nav>
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

function SettingsNavBody(props: { companyId: number; companyName: string; back: string; sidebar: boolean }) {
  return (
    <>
      <BackLink to={props.back} />
      {settingsGroups(props.companyName).map((g) => (
        <div key={g.key} className={g.title ? 'mt-3 border-t border-field pt-3' : ''}>
          {g.title && <p className="mb-1 truncate px-3 text-xs font-semibold uppercase tracking-wide text-muted">{g.title}</p>}
          <div className={props.sidebar ? 'grid gap-0.5' : 'flex flex-wrap gap-1'}>
            {g.items.map((s) => (
              <NavLink key={s.path} to={`/c/${props.companyId}/settings/${s.path}`} className={props.sidebar ? sidebarLink : inlineLink}>
                {s.label}
              </NavLink>
            ))}
          </div>
        </div>
      ))}
    </>
  );
}
