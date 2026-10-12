import { Navigate, Outlet, useLocation, useMatch, useOutletContext, useParams } from 'react-router';
import { mainCardClass } from '../../components/ui';
import { useIsMobile } from '../../lib/media';
import { DEFAULT_SETTINGS_SECTION } from '../../lib/settings-sections';
import type { CompanyOutletContext } from '../CompanyLayout';
import { SettingsListLink, SettingsNav } from './SettingsNav';

/**
 * Зона настроек (§4.1, §8.6 этапа 1.5): на компьютере слева вместо панели счетов — меню разделов, справа — белая
 * карточка с разделом. На телефоне раздел — на весь экран, над ним «← Настройки» (кроме самого экрана «Настройки»).
 * Заголовок раздела — `<h1>` самой страницы.
 */
export function SettingsLayout() {
  const context = useOutletContext<CompanyOutletContext>();
  const atList = useMatch('/c/:companyId/settings') !== null;
  return (
    <>
      <SettingsNav company={context.company} variant="sidebar" />
      <main className={mainCardClass}>
        {!atList && <SettingsListLink companyId={context.company.id} />}
        <Outlet context={context} />
      </main>
    </>
  );
}

/**
 * «Настройки» без раздела (§4.2, §8.6 этапа 1.5): на телефоне — экран «Настройки» со списком разделов по группам;
 * на компьютере — сразу «Контрагенты» (разделы и так в меню слева). Окно стало шире на этом экране — тоже перенаправление.
 */
export function SettingsIndex() {
  const { company } = useOutletContext<CompanyOutletContext>();
  const mobile = useIsMobile();
  if (!mobile) return <SettingsRedirect section={DEFAULT_SETTINGS_SECTION} />;
  return (
    <>
      <h1 className="mb-4 text-2xl font-bold">Настройки</h1>
      <SettingsNav company={company} variant="list" />
    </>
  );
}

/** Перенаправление внутри настроек компании: старые адреса и закладки (§4.2). */
export function SettingsRedirect({ section }: { section: string }) {
  const { companyId } = useParams();
  const { search, hash } = useLocation();
  return <Navigate to={`/c/${companyId}/settings/${section}${search}${hash}`} replace />;
}
