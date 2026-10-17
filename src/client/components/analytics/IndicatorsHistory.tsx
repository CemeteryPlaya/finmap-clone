import { formatDateTime } from '../../../shared/dates';
import { historyRows } from '../../lib/indicators';
import { useAuditFeed } from '../../lib/queries';
import { LoadMore } from '../journal/LoadMore';
import { ReportLoading } from './ReportParts';

const HEADERS = ['Действие', 'Дата', 'Показатель', 'Категории', 'Сотрудник'];

/**
 * Вкладка «История» (§8.2): изменения настроек показателей из истории действий (`indicator_part`), новые сверху:
 * «Действие», «Дата», «Показатель» (часть), «Категории» (настройка после изменения), «Сотрудник».
 */
export function IndicatorsHistory(props: { companyId: number; timeZone: string }) {
  const feed = useAuditFeed(props.companyId, { entity: 'indicator_part' });
  if (!feed.data) return <ReportLoading error={feed.error} onRetry={() => void feed.refetch()} />;
  const rows = historyRows(feed.data.pages.flatMap((p) => p.entries));
  return (
    <div role="region" aria-label="История изменений показателей" className="overflow-x-auto rounded-xl">
      <table className="w-full min-w-max border-collapse text-sm">
        <caption className="sr-only">История изменений показателей</caption>
        <thead>
          <tr className="h-12 border-b border-field">
            {HEADERS.map((h) => (
              <th key={h} scope="col" className="px-3 text-left text-xs font-semibold text-muted">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 ? (
            <tr>
              <td colSpan={HEADERS.length} className="py-10 text-center text-muted">
                Изменений пока нет
              </td>
            </tr>
          ) : (
            rows.map((r) => (
              <tr key={r.id} className="border-b border-field align-top">
                <td className="px-3 py-2">{r.action}</td>
                <td className="px-3 py-2 whitespace-nowrap">{formatDateTime(r.at, props.timeZone)}</td>
                <td className="px-3 py-2">{r.part}</td>
                <td className="max-w-md px-3 py-2 whitespace-normal">{r.categories}</td>
                <td className="px-3 py-2">{r.user}</td>
              </tr>
            ))
          )}
        </tbody>
      </table>
      <LoadMore hasNext={feed.hasNextPage} loading={feed.isFetchingNextPage} failed={feed.isFetchNextPageError} onLoad={() => void feed.fetchNextPage()} />
    </div>
  );
}
