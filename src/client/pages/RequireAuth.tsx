import { Navigate, Outlet } from 'react-router';
import { useMe } from '../lib/query';

export function RequireAuth() {
  const me = useMe();
  if (me.isPending) return <div className="p-8 text-muted">Загрузка…</div>;
  if (me.error?.status === 401) return <Navigate to="/login" replace />;
  if (me.error) return <div className="p-8 text-expense">{me.error.message}</div>;
  return <Outlet />;
}
