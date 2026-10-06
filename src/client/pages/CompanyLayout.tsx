import { Navigate, NavLink, Outlet, useParams } from 'react-router';
import { AppHeader } from '../components/AppHeader';
import { CompanySwitcher } from '../components/CompanySwitcher';
import { useCompanies, type Company } from '../lib/queries';

export interface CompanyOutletContext {
  company: Company;
}

const tab = ({ isActive }: { isActive: boolean }) =>
  `rounded-full px-5 py-2 text-lg font-semibold ${isActive ? 'bg-ink text-white' : 'text-muted hover:text-ink'}`;

export function CompanyLayout() {
  const { companyId } = useParams();
  const companies = useCompanies();
  if (companies.isPending) return <div className="p-8 text-muted">Загрузка…</div>;
  if (companies.error) return <div className="p-8 text-expense">{companies.error.message}</div>;
  const company = companies.data.find((c) => String(c.id) === companyId);
  if (!company) return <Navigate to="/" replace />;

  return (
    <div className="min-h-dvh bg-chrome">
      <AppHeader left={<CompanySwitcher current={company} companies={companies.data} />} />
      <main className="mx-4 min-h-[calc(100dvh-5rem)] rounded-t-3xl bg-card p-6 md:p-8">
        <nav className="mb-6 flex gap-2">
          <NavLink to={`/c/${company.id}/log`} className={tab}>
            Журнал
          </NavLink>
          <NavLink to={`/c/${company.id}/settings`} className={tab}>
            Настройки
          </NavLink>
        </nav>
        <Outlet context={{ company } satisfies CompanyOutletContext} />
      </main>
    </div>
  );
}
