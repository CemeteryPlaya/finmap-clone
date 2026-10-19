import { Link, Navigate, NavLink, Outlet, useLocation, useOutletContext, useSearchParams } from 'react-router';
import { Pending } from '../components/QueryState';
import { inputClass, noticeClass } from '../components/ui';
import { useStockWarehouses, type StockWarehouse } from '../lib/stock';
import { DEFAULT_STOCK_TAB, effectiveWarehouse, STOCK_TABS, stockHref, warehouseParam } from '../lib/stock-view';
import type { Company } from '../lib/queries';
import type { CompanyOutletContext } from './CompanyLayout';

/** Что получают подвкладки экрана «Склад»: компания, выбранный склад (null — складов нет) и список складов. */
export interface StockOutletContext {
  company: Company;
  warehouse: number | null;
  warehouses: StockWarehouse[];
  /** «Аналитика»: выбраны «Все склады» (`?warehouse=all`) — warehouse тогда только склад по умолчанию. */
  allWarehouses: boolean;
}

/** `…/stock` без подвкладки и неизвестные адреса: на подвкладку по умолчанию, склад из адреса остаётся. */
export function StockIndex() {
  const { company } = useOutletContext<StockOutletContext>();
  const { search } = useLocation();
  return <Navigate to={{ pathname: `/c/${company.id}/stock/${DEFAULT_STOCK_TAB}`, search }} replace />;
}

const pill = ({ isActive }: { isActive: boolean }) =>
  `rounded-full px-4 py-1.5 text-base font-semibold ${isActive ? 'bg-ink text-white' : 'bg-field text-muted hover:text-ink'}`;

/**
 * Экран «Склад» (§4 спецификации «Склад»): склад в адресе (`?warehouse=`), подвкладки «Остатки», «Товары». Без склада в адресе
 * выбран первый неархивный (иначе первый) — «Все склады» не предлагается, остатки запрашиваются по одному складу.
 * Маршрут не пересоздаёт страницу при смене компании — содержимое с key.
 */
export function StockPage() {
  const { company } = useOutletContext<CompanyOutletContext>();
  const warehouses = useStockWarehouses(company.id);
  const [search, setSearch] = useSearchParams();
  const location = useLocation();
  if (!warehouses.data) {
    return (
      <section key={company.id}>
        <h1 className="mb-4 text-2xl font-bold">Склад</h1>
        <Pending queries={[warehouses]} />
      </section>
    );
  }
  const list = warehouses.data;
  const fromUrl = warehouseParam(search, list);
  const warehouse = effectiveWarehouse(fromUrl, list);
  // «Все склады» — только у «Аналитики» (§8): остатки и документы считаются по одному складу
  const onAnalytics = /\/stock\/analytics\/?$/.test(location.pathname);
  const allWarehouses = onAnalytics && search.get('warehouse') === 'all';
  const pick = (value: string) => {
    const next = new URLSearchParams(search);
    next.set('warehouse', value);
    setSearch(next, { replace: true });
  };

  return (
    <section key={company.id}>
      <h1 className="mb-4 text-2xl font-bold">Склад</h1>
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <nav aria-label="Разделы склада" className="flex flex-wrap gap-2">
          {STOCK_TABS.map((t) => (
            <NavLink key={t.path} to={stockHref(company.id, t.path, fromUrl)} className={pill}>
              {t.label}
            </NavLink>
          ))}
        </nav>
        {list.length > 0 && (
          <label className="ml-auto flex items-center gap-2 whitespace-nowrap text-sm text-muted">
            Склад
            <select aria-label="Склад" value={allWarehouses ? 'all' : (warehouse ?? '')} onChange={(e) => pick(e.target.value)} className={`${inputClass} w-auto! py-2`}>
              {onAnalytics && <option value="all">Все склады</option>}
              {list.map((w) => (
                <option key={w.id} value={w.id}>
                  {w.name}
                  {w.archivedAt ? ' (в архиве)' : ''}
                </option>
              ))}
            </select>
          </label>
        )}
      </div>
      {list.length === 0 && (
        <p className={noticeClass}>
          Складов пока нет.{' '}
          <Link to={`/c/${company.id}/settings/warehouses`} className="font-semibold underline">
            Создайте склад в настройках
          </Link>
          : у каждого проекта — свой склад.
        </p>
      )}
      <Outlet context={{ company, warehouse, warehouses: list, allWarehouses } satisfies StockOutletContext} />
    </section>
  );
}
