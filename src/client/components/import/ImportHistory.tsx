import { useEffect, useRef } from 'react';
import { importAddedText, importMetaText, importUndoneText } from '../../lib/import-history';
import { useMeta } from '../../lib/query';
import { useImports, type Company } from '../../lib/queries';
import { Pending } from '../QueryState';
import { btnSecondary } from '../ui';

/**
 * Вкладка «Импорты» панели «История действий» (§7.2 спецификации импорта): импорты компании, новые сверху, «Показать ещё».
 */
export function ImportHistory({ company }: { company: Company }) {
  const feed = useImports(company.id);
  const meta = useMeta();
  const listRef = useRef<HTMLUListElement>(null);
  /** Номер первой записи новой страницы, пока «Показать ещё» держит фокус (R2): если кнопка исчезла, фокус — на неё, а не в никуда. */
  const focusFrom = useRef<number | null>(null);
  const hasNext = feed.hasNextPage;
  const fetching = feed.isFetchingNextPage;
  useEffect(() => {
    if (fetching || focusFrom.current === null) return;
    const from = focusFrom.current;
    focusFrom.current = null;
    if (hasNext) return; // кнопка осталась — фокус на ней
    const list = listRef.current;
    const target = (list?.children[from] as HTMLElement | undefined) ?? list;
    target?.focus({ preventScroll: true });
  }, [fetching, hasNext]);
  // прошлый список при повторном открытии не показываем: «Загрузка…», пока не пришёл свежий ответ
  if (!feed.data || !feed.isFetchedAfterMount || !meta.data) return <Pending queries={[feed, meta]} />;
  const timeZone = meta.data.timezone;
  const items = feed.data.pages.flatMap((p) => p.items);
  if (items.length === 0) return <p className="text-sm text-muted">Импортов пока не было.</p>;

  return (
    <div>
      <ul ref={listRef} tabIndex={-1} aria-label="Импорты" className="divide-y divide-field focus:outline-none">
        {items.map((it) => {
          const undone = importUndoneText(it, timeZone);
          return (
            <li key={it.id} tabIndex={-1} className="flex items-start gap-2 py-2 focus:outline-none">
              <div className="min-w-0 flex-1 px-2 py-1">
                <span title={it.fileName} className="block truncate font-semibold">
                  {it.fileName}
                </span>
                <span className="block text-sm">{importAddedText(it)}</span>
                {undone && <span className="block text-sm">{undone}</span>}
                <span className="block text-xs text-muted">{importMetaText(it, timeZone)}</span>
              </div>
            </li>
          );
        })}
      </ul>
      {feed.hasNextPage && (
        <button
          type="button"
          onClick={() => {
            if (feed.isFetchingNextPage) return;
            focusFrom.current = items.length;
            void feed.fetchNextPage();
          }}
          aria-disabled={feed.isFetchingNextPage}
          className={`${btnSecondary} mt-3 w-full ${feed.isFetchingNextPage ? 'cursor-wait opacity-60' : ''}`}
        >
          {feed.isFetchingNextPage ? 'Загрузка…' : 'Показать ещё'}
        </button>
      )}
    </div>
  );
}
