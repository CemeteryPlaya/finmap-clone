import { Navigate } from 'react-router';
import { LoadError } from '../components/LoadError';
import { useCompanies } from '../lib/queries';

export function CompanyGate() {
  const companies = useCompanies();
  if (!companies.data) {
    if (companies.error) return <LoadError message={companies.error.message} onRetry={() => void companies.refetch()} />;
    return <div className="p-8 text-muted">Загрузка…</div>;
  }
  const first = companies.data.find((c) => !c.archivedAt);
  return <Navigate to={first ? `/c/${first.id}/log` : '/companies/new'} replace />;
}
