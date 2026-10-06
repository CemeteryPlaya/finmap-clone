import { NavLink } from 'react-router';

const link = ({ isActive }: { isActive: boolean }) =>
  `rounded-xl px-3 py-2 text-sm ${isActive ? 'bg-field font-semibold text-ink' : 'text-muted hover:text-ink'}`;

export function SettingsNav({ companyId }: { companyId: number }) {
  return (
    <nav className="mb-6 flex gap-2" aria-label="Разделы настроек">
      <NavLink to={`/c/${companyId}/settings/projects`} className={link}>
        Проекты
      </NavLink>
      <NavLink to={`/c/${companyId}/settings/companies`} className={link}>
        Компании
      </NavLink>
    </nav>
  );
}
