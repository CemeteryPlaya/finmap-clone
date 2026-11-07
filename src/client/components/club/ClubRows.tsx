import { useEffect, useId, useRef } from 'react';
import { formatDateTime } from '../../../shared/dates';
import { clubMoney, useClubCellRows, type CellItemView } from '../../lib/club-revenue';
import { LoadMore } from '../journal/LoadMore';
import { btnClose, btnSecondary } from '../ui';

const KIND: Record<CellItemView['kind'], string> = { session: 'Сеанс', package: 'Абонемент', sale: 'Бар', refill: 'Пополнение', transaction: 'Касса' };

/** Гость строки: логин и маска телефона (полный номер не хранится, §12). */
const guestOf = (i: CellItemView) => [i.guest, i.phoneMask].filter(Boolean).join(' · ');

/**
 * Строки Senet, из которых сложилась ячейка отчёта клуба (спецификация «Аналитика клуба», §2.2): заголовок «{строка} за
 * {колонка}» получает фокус при открытии, «×» закрывает; страницы по 50. Это строки Senet — ссылок на операции у них нет.
 */
export function ClubRows(props: { companyId: number; report?: 'revenue' | 'load' | 'bar'; title: string; params: string; timeZone: string; onClose: () => void }) {
  const list = useClubCellRows(props.companyId, props.report ?? 'revenue', props.params);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const headingId = useId();
  useEffect(() => headingRef.current?.focus(), [props.params]);
  const items = list.data?.pages.flatMap((p) => p.items) ?? [];

  return (
    <section aria-labelledby={headingId} className="mt-8">
      <div className="mb-3 flex items-start justify-between gap-3">
        <h2 id={headingId} ref={headingRef} tabIndex={-1} className="text-xl font-bold outline-none">
          {props.title}
        </h2>
        <button type="button" aria-label="Закрыть список" title="Закрыть" onClick={props.onClose} className={btnClose}>
          <span aria-hidden="true">×</span>
        </button>
      </div>
      {!list.data && !list.error ? (
        <p className="py-6 text-center text-muted">Загрузка…</p>
      ) : !list.data ? (
        <div className="py-6 text-center">
          <p role="alert" className="mb-4 text-expense-strong">
            {list.error?.message}
          </p>
          <button type="button" onClick={() => void list.refetch()} className={btnSecondary}>
            Повторить
          </button>
        </div>
      ) : items.length === 0 ? (
        <p className="py-6 text-center text-muted">Строк Senet нет.</p>
      ) : (
        <div role="region" aria-label={`${props.title}: строки Senet`} tabIndex={0} className="overflow-x-auto rounded-xl focus-visible:outline-2 focus-visible:outline-focus">
          <table aria-busy={list.isFetching && !list.isFetchingNextPage} className="w-full min-w-max border-collapse text-sm">
            <caption className="sr-only">{`${props.title}: строки Senet`}</caption>
            <thead>
              <tr className="h-10 border-b border-field text-xs font-semibold text-muted">
                <th scope="col" className="px-3 text-left">Время</th>
                <th scope="col" className="px-3 text-left">Что</th>
                <th scope="col" className="px-3 text-left">Гость</th>
                <th scope="col" className="px-3 text-right">Сумма</th>
              </tr>
            </thead>
            <tbody>
              {items.map((i, n) => (
                <tr key={`${i.at}-${n}`} className="border-b border-field">
                  <td className="px-3 py-2 whitespace-nowrap">{formatDateTime(i.at, props.timeZone)}</td>
                  <td className="px-3 py-2">
                    <span className="text-muted">{KIND[i.kind]}</span>
                    {i.label && ` · ${i.label}`}
                  </td>
                  <td className="px-3 py-2">{guestOf(i)}</td>
                  <td className={`px-3 py-2 text-right whitespace-nowrap ${i.amount < 0 ? 'text-expense-strong' : ''}`}>{clubMoney(i.amount)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {list.data && <LoadMore hasNext={list.hasNextPage} loading={list.isFetchingNextPage} failed={list.isFetchNextPageError} onLoad={() => void list.fetchNextPage()} />}
    </section>
  );
}
