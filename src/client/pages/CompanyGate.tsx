import { Navigate } from 'react-router';
import { LoadError } from '../components/LoadError';
import { pickStartCompany } from '../lib/company-path';
import { useCompanies, usePreferences } from '../lib/queries';

export function CompanyGate() {
  const companies = useCompanies();
  const prefs = usePreferences();
  if (!companies.data) {
    if (companies.error) return <LoadError message={companies.error.message} onRetry={() => void companies.refetch()} />;
    return <div className="p-8 text-muted">Загрузка…</div>;
  }
  // настройки не блокируют вход: при их ошибке открываем первую активную компанию
  if (prefs.isPending) return <div className="p-8 text-muted">Загрузка…</div>;
  const start = pickStartCompany(companies.data, prefs.data?.lastCompanyId);
  return <Navigate to={start ? `/c/${start.id}/log` : '/companies/new'} replace />;
}
