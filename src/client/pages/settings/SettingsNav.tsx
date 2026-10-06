import { NavLink } from 'react-router';

/** Разделы настроек по порядку; «Компании» всегда последние. */
const SECTIONS: readonly { path: string; label: string }[] = [
  { path: 'projects', label: 'Проекты' },
  { path: 'companies', label: 'Компании' },
];

const link = ({ isActive }: { isActive: boolean }) =>
  `rounded-xl px-3 py-2 text-sm ${isActive ? 'bg-field font-semibold text-ink' : 'text-muted hover:text-ink'}`;

export function SettingsNav({ companyId }: { companyId: number }) {
  return (
    <nav className="mb-6 flex flex-wrap gap-2" aria-label="Разделы настроек">
      {SECTIONS.map((s) => (
        <NavLink key={s.path} to={`/c/${companyId}/settings/${s.path}`} className={link}>
          {s.label}
        </NavLink>
      ))}
    </nav>
  );
}
