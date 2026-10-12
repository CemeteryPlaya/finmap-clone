import { useEffect } from 'react';
import { Navigate, NavLink, Outlet, useMatch, useParams } from 'react-router';
import { AccountsDrawerButton, AccountsPanel } from '../components/AccountsPanel';
import { AppHeader } from '../components/AppHeader';
import { CompanyBlockButton } from '../components/CompaniesDrawer';
import { HistoryButton } from '../components/HistoryDrawer';
import { LoadError } from '../components/LoadError';
import { NewOperationButtons, OperationFormHost } from '../components/operation/OperationFormHost';
import { mainCardClass } from '../components/ui';
import { savePreference, useCompanies, usePreferences, type Company } from '../lib/queries';

export interface CompanyOutletContext {
  company: Company;
}

const tab = ({ isActive }: { isActive: boolean }) =>
  `rounded-full px-5 py-2 text-lg font-semibold ${isActive ? 'bg-ink text-white' : 'text-muted hover:text-ink'}`;

export function CompanyLayout() {
  const { companyId } = useParams();
  // зона настроек (§4.1 этапа 1.5): слева навигация разделов вместо панели счетов, вкладок нет
  const inSettings = useMatch('/c/:companyId/settings/*') !== null;
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
          menuButton={<AccountsDrawerButton company={company} />}
          company={<CompanyBlockButton current={company} companies={companies.data} />}
          // архивная компания — только чтение: кнопок новых операций нет ни на компьютере, ни на телефоне
          actions={company.archivedAt ? undefined : <NewOperationButtons />}
          tools={<HistoryButton company={company} />}
          menu={{ companyId: company.id, companyName: company.name }}
        />
        <div className="flex items-start gap-4 md:mx-4">
          {inSettings ? (
            <Outlet context={{ company } satisfies CompanyOutletContext} />
          ) : (
            <>
              <AccountsPanel company={company} />
              <main className={mainCardClass}>
                <nav className="mb-6 flex gap-2">
                  <NavLink to={`/c/${company.id}/log`} className={tab}>
                    Журнал
                  </NavLink>
                </nav>
                <Outlet context={{ company } satisfies CompanyOutletContext} />
              </main>
            </>
          )}
        </div>
      </div>
    </OperationFormHost>
  );
}
