import { useEffect } from 'react';
import { Navigate, NavLink, Outlet, useParams } from 'react-router';
import { AccountsDrawerButton, AccountsPanel } from '../components/AccountsPanel';
import { AppHeader } from '../components/AppHeader';
import { CompanySwitcher } from '../components/CompanySwitcher';
import { LoadError } from '../components/LoadError';
import { NewOperationButtons, OperationFormHost } from '../components/operation/OperationFormHost';
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
    <OperationFormHost company={company}>
      <div className="min-h-dvh bg-chrome">
        <AppHeader
          left={
            <>
              <AccountsDrawerButton company={company} />
              <CompanySwitcher current={company} companies={companies.data} />
            </>
          }
          actions={<NewOperationButtons />}
          profileHref={`/c/${company.id}/settings/profile`}
        />
        <div className="flex items-start gap-4 md:mx-4">
          <AccountsPanel company={company} />
          {/* на телефоне снизу — место под закреплённую панель «Доход», «Расход», «Перевод» */}
          <main className="min-h-[calc(100dvh-5rem)] min-w-0 flex-1 rounded-t-3xl bg-card p-4 pb-[calc(6rem+env(safe-area-inset-bottom))] md:p-8">
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
        <NewOperationButtons placement="bottom" />
      </div>
    </OperationFormHost>
  );
}
