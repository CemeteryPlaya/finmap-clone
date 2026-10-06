import { Navigate } from 'react-router';
import { useCompanies } from '../lib/queries';

export function CompanyGate() {
  const companies = useCompanies();
  if (companies.isPending) return <div className="p-8 text-muted">Загрузка…</div>;
  if (companies.error) return <div className="p-8 text-expense">{companies.error.message}</div>;
  const first = companies.data.find((c) => !c.archivedAt);
  return <Navigate to={first ? `/c/${first.id}/log` : '/companies/new'} replace />;
}
