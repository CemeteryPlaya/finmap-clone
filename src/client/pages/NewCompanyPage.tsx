import { Link, useNavigate } from 'react-router';
import { AppHeader } from '../components/AppHeader';
import { CompanyForm } from '../components/CompanyForm';
import { LoadError } from '../components/LoadError';
import { pickStartCompany } from '../lib/company-path';
import { useCompanies, usePreferences } from '../lib/queries';

export function NewCompanyPage() {
  const navigate = useNavigate();
  const companies = useCompanies();
  const prefs = usePreferences();

  if (!companies.data) {
    return (
      <div className="min-h-dvh bg-chrome">
        <AppHeader menu={{ companyId: null, companyName: null }} />
        <main className="mx-auto mt-8 max-w-md rounded-3xl bg-card p-8">
          {companies.error ? (
            <LoadError message={companies.error.message} onRetry={() => void companies.refetch()} />
          ) : (
            <div className="text-muted">Загрузка…</div>
          )}
        </main>
      </div>
    );
  }

  const all = companies.data;
  const hasActive = all.some((c) => !c.archivedAt);
  const archived = all.find((c) => c.archivedAt);
  return (
    <div className="min-h-dvh bg-chrome">
      {/* ссылки «Мой аккаунт» в панели «Настройки» — от последней открытой компании; группы «Моя компания» нет */}
      <AppHeader menu={{ companyId: pickStartCompany(all, prefs.data?.lastCompanyId)?.id ?? null, companyName: null }} />
      <main className="mx-auto mt-8 max-w-md rounded-3xl bg-card p-8">
        <h1 className="mb-6 text-2xl font-bold">{hasActive ? 'Новая компания' : 'Создайте первую компанию'}</h1>
        {!hasActive && archived && (
          <p className="mb-4 rounded-xl bg-field px-4 py-3 text-sm text-muted">
            Все компании в архиве.{' '}
            <Link to={`/c/${archived.id}/settings/companies`} className="font-semibold text-ink underline">
              Открыть список компаний
            </Link>
            , чтобы вернуть нужную из архива.
          </p>
        )}
        <CompanyForm onCreated={(c) => navigate(`/c/${c.id}/log`, { replace: true })} />
        {hasActive && (
          <Link to="/" className="mt-4 inline-block text-sm font-semibold text-muted underline hover:text-ink">
            Отмена
          </Link>
        )}
      </main>
    </div>
  );
}
