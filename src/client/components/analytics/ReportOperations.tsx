import { useEffect, useRef } from 'react';
import { useCellOperations } from '../../lib/analytics';
import type { JournalColumnId } from '../../lib/journal-columns';
import { uniqueById } from '../../lib/journal-format';
import type { Company } from '../../lib/queries';
import { JournalCards } from '../journal/JournalCards';
import { JournalTable, type JournalLookups } from '../journal/JournalTable';
import { LoadMore } from '../journal/LoadMore';
import { useOpenOperationForm } from '../operation/OperationFormHost';
import { btnClose, btnSecondary } from '../ui';

/** Колонки списка под отчётом (§2.5): дата, сумма, счёт с остатком, контрагент, категория, проект, комментарий. */
const COLUMNS: readonly JournalColumnId[] = ['date', 'amount', 'account', 'counterparty', 'category', 'project', 'comment'];

/**
 * Список операций ячейки под отчётом (§2.5 спецификации «Аналитика»), общий для отчётов: заголовок «{строка} за {колонка}»
 * получает фокус при открытии, «×» закрывает. Строки — компоненты журнала (таблица, на телефоне — карточки): у разбитой
 * операции сумма — только строк ячейки и пометка «часть операции». Щелчок по строке открывает форму операции; после
 * сохранения отчёт и список перечитываются (invalidateAnalytics). Подгрузка страницами, как журнал.
 */
export function ReportOperations(props: {
  company: Company;
  title: string;
  /** Строка запроса операций ячейки: параметры отчёта, report, row и col. */
  params: string;
  lookups: JournalLookups;
  timeZone: string;
  today: string;
  mobile: boolean;
  onClose: () => void;
}) {
  const list = useCellOperations(props.company.id, props.params);
  const openForm = useOpenOperationForm();
  const headingRef = useRef<HTMLHeadingElement>(null);
  // новая ячейка — фокус на заголовок списка
  useEffect(() => {
    headingRef.current?.focus();
  }, [props.params]);

  const items = uniqueById(list.data?.pages.flatMap((p) => p.items) ?? []);
  const parts = new Map(items.flatMap((i) => (i.part === null ? [] : [[i.id, i.part] as const])));
  const open = (item: { id: number }) => openForm({ kind: 'edit', id: item.id, focusAfterDelete: () => headingRef.current });

  return (
    <section aria-labelledby="report-operations-title" className="mt-8">
      <div className="mb-3 flex items-start justify-between gap-3">
        <h2 id="report-operations-title" ref={headingRef} tabIndex={-1} className="text-xl font-bold outline-none">
          {props.title}
        </h2>
        <button type="button" aria-label="Закрыть список операций" title="Закрыть" onClick={props.onClose} className={btnClose}>
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
        <p className="py-6 text-center text-muted">Операций нет.</p>
      ) : props.mobile ? (
        <JournalCards items={items} lookups={props.lookups} baseCurrency={props.company.baseCurrency} timeZone={props.timeZone} busy={list.isFetching && !list.isFetchingNextPage} parts={parts} onOpenOperation={open} />
      ) : (
        <JournalTable
          items={items}
          columns={COLUMNS}
          wrap={false}
          lookups={props.lookups}
          baseCurrency={props.company.baseCurrency}
          timeZone={props.timeZone}
          today={props.today}
          projectFilter={[]}
          busy={list.isFetching && !list.isFetchingNextPage}
          parts={parts}
          onOpenOperation={open}
        />
      )}
      {list.data && <LoadMore hasNext={list.hasNextPage} loading={list.isFetchingNextPage} failed={list.isFetchNextPageError} onLoad={() => void list.fetchNextPage()} />}
    </section>
  );
}
