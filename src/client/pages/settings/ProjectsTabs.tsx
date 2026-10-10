import { NavLink } from 'react-router';

const tab = ({ isActive }: { isActive: boolean }) =>
  `-mb-px border-b-2 px-1 pb-2 text-sm font-semibold ${isActive ? 'border-ink text-ink' : 'border-transparent text-muted hover:text-ink'}`;

/** Вкладки раздела «Проекты» (§4.2, §7.4 этапа 1.5): проекты и шаблоны разделения. */
export function ProjectsTabs({ companyId }: { companyId: number }) {
  return (
    <nav aria-label="Проекты и шаблоны" className="mb-6 flex gap-6 border-b border-field">
      <NavLink end to={`/c/${companyId}/settings/projects`} className={tab}>
        Проекты
      </NavLink>
      <NavLink to={`/c/${companyId}/settings/projects/split-presets`} className={tab}>
        Шаблоны разделения
      </NavLink>
    </nav>
  );
}
