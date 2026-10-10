import { Navigate, Outlet, useLocation, useOutletContext, useParams } from 'react-router';
import { mainCardClass } from '../../components/ui';
import type { CompanyOutletContext } from '../CompanyLayout';
import { SettingsNav } from './SettingsNav';

/**
 * Зона настроек (§4.1 этапа 1.5): слева вместо панели счетов — навигация разделов, справа — белая карточка
 * с разделом. Заголовок раздела — `<h1>` самой страницы. На телефоне навигация — строкой над разделом.
 */
export function SettingsLayout() {
  const context = useOutletContext<CompanyOutletContext>();
  return (
    <>
      <SettingsNav company={context.company} variant="sidebar" />
      <main className={mainCardClass}>
        <SettingsNav company={context.company} variant="inline" />
        <Outlet context={context} />
      </main>
    </>
  );
}

/** Перенаправление внутри настроек компании: старые адреса и закладки (§4.2). */
export function SettingsRedirect({ section }: { section: string }) {
  const { companyId } = useParams();
  const { search, hash } = useLocation();
  return <Navigate to={`/c/${companyId}/settings/${section}${search}${hash}`} replace />;
}
