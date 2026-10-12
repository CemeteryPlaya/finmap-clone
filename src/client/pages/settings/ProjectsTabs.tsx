import { NavLink } from 'react-router';

const tab = ({ isActive }: { isActive: boolean }) =>
  `-mb-px border-b-2 px-1 pb-2 text-sm font-semibold max-md:inline-flex max-md:min-h-11 max-md:items-end ${isActive ? 'border-income-strong text-income-strong' : 'border-transparent text-muted hover:text-ink'}`;

/**
 * Шапка раздела «Проекты» (§4.2, §7.4 этапа 1.5): заголовок «Проекты» и вкладки с подчёркиванием «Проекты | Шаблоны
 * разделения» — как в Finmap, заголовок один на обеих вкладках, текущая вкладка — `aria-current="page"`.
 */
export function ProjectsHeader({ companyId }: { companyId: number }) {
  return (
    <>
      <h1 className="mb-4 text-2xl font-bold">Проекты</h1>
      <nav aria-label="Проекты и шаблоны" className="mb-6 flex gap-6 border-b border-field">
        <NavLink end to={`/c/${companyId}/settings/projects`} className={tab}>
          Проекты
        </NavLink>
        <NavLink to={`/c/${companyId}/settings/projects/split-presets`} className={tab}>
          Шаблоны разделения
        </NavLink>
      </nav>
    </>
  );
}
