import { Link } from 'react-router';
import { accessBanner, useSenetStatus } from '../../lib/senet';
import { alertClass } from '../ui';

/** «Обновите доступ к Senet — забор остановлен» (§8.2): пока подключение в key_rejected, над журналом и сверкой. */
export function AccessBanner(props: { companyId: number }) {
  const status = useSenetStatus(props.companyId);
  const banner = status.data ? accessBanner(props.companyId, status.data) : null;
  if (!banner) return null;
  return (
    <p role="alert" className={alertClass}>
      {banner.text}.{' '}
      <Link to={banner.href} className="font-semibold underline">
        Открыть подключение
      </Link>
    </p>
  );
}
