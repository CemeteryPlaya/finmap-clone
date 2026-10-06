import { useEffect } from 'react';
import { Navigate, NavLink, Outlet, useParams } from 'react-router';
import { AccountsPanel } from '../components/AccountsPanel';
import { AppHeader } from '../components/AppHeader';
import { CompanySwitcher } from '../components/CompanySwitcher';
import { LoadError } from '../components/LoadError';
import { savePreference, useCompanies, usePreferences, type Company } from '../lib/queries';

export interface CompanyOutletContext {
  company: Company;
}

const tab = ({ isActive }: { isActive: boolean }) =>
  `rounded-full px-5 py-2 text-lg font-semibold ${isActive ? 'bg-ink text-white' : 'text-muted hover:text-ink'}`;

export function CompanyLayout() {
  const { companyId } = useParams();
  const companies = useCompanies();
  const prefs = usePreferences();
  const company = companies.data?.find((c) => String(c.id) === companyId);
  const currentId = company?.id;
  const savedId = prefs.data?.lastCompanyId;

  // запоминаем последнюю открытую компанию; сбой не критичен — стартовый экран откроет первую активную
  useEffect(() => {
    if (currentId === undefined || prefs.data === undefined || savedId === currentId) return;
    savePreference('lastCompanyId', currentId).catch(() => undefined);
  }, [currentId, savedId, prefs.data]);

  if (!companies.data) {
    if (companies.error) return <LoadError message={companies.error.message} onRetry={() => void companies.refetch()} />;
    return <div className="p-8 text-muted">Загрузка…</div>;
  }
  if (!company) return <Navigate to="/" replace />;

  return (
    <div className="min-h-dvh bg-chrome">
      <AppHeader
        left={<CompanySwitcher current={company} companies={companies.data} />}
        profileHref={`/c/${company.id}/settings/profile`}
      />
      <div className="mx-4 flex items-start gap-4">
        <AccountsPanel company={company} />
        <main className="min-h-[calc(100dvh-5rem)] min-w-0 flex-1 rounded-t-3xl bg-card p-6 md:p-8">
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
    </div>
  );
}
