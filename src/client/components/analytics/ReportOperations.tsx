import { useEffect, useId, useRef } from 'react';
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
export const REPORT_OPERATION_COLUMNS: readonly JournalColumnId[] = ['date', 'amount', 'account', 'counterparty', 'category', 'project', 'comment'];

/** Подпись над списками «Прибыли» (R5): сортировка остаётся по дате платежа. */
export const DEAL_ORDER_NOTE = 'Новые сверху по дате платежа';

/**
 * Список операций под отчётом (§2.5 спецификации «Аналитика»), общий для отчётов. В таблице — список ячейки: заголовок
 * «{строка} за {колонка}» получает фокус при открытии, «×» закрывает. Под графиками (§4.2) — списки периода в две колонки:
 * без «×», фокус остаётся на колонке графика (autoFocus = false), колонок меньше (narrow). Строки — компоненты журнала
 * (таблица, на телефоне — карточки): у разбитой операции сумма — только строк ячейки и пометка «часть операции». Щелчок
 * по строке открывает форму операции; после сохранения отчёт и список перечитываются (invalidateAnalytics). Подгрузка
 * страницами, как журнал.
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
  /** «×» — закрыть список ячейки; без него кнопки нет (списки под графиками). */
  onClose?: () => void;
  autoFocus?: boolean;
  headingLevel?: 2 | 3;
  columns?: readonly JournalColumnId[];
  narrow?: boolean;
  /** «Прибыль» (§5.2): «Дата сделки» и «Движение денег». */
  dealDates?: boolean;
  /** Приглушённая подпись под списком (R14: склад в список операций не входит). */
  footnote?: string;
}) {
  const list = useCellOperations(props.company.id, props.params);
  const openForm = useOpenOperationForm();
  const headingRef = useRef<HTMLHeadingElement>(null);
  const headingId = useId();
  const autoFocus = props.autoFocus ?? true;
  // новая ячейка — фокус на заголовок списка
  useEffect(() => {
    if (autoFocus) headingRef.current?.focus();
  }, [props.params, autoFocus]);

  const items = uniqueById(list.data?.pages.flatMap((p) => p.items) ?? []);
  const parts = new Map(items.flatMap((i) => (i.part === null ? [] : [[i.id, i.part] as const])));
  const open = (item: { id: number }) => openForm({ kind: 'edit', id: item.id, focusAfterDelete: () => headingRef.current });
  const Heading = props.headingLevel === 3 ? 'h3' : 'h2';

  return (
    <section data-report-operations="" aria-labelledby={headingId} className={props.headingLevel === 3 ? 'min-w-0' : 'mt-8'}>
      <div className="mb-3 flex items-start justify-between gap-3">
        <Heading id={headingId} ref={headingRef} tabIndex={-1} className={`${props.headingLevel === 3 ? 'text-base' : 'text-xl'} font-bold outline-none`}>
          {props.title}
        </Heading>
        {props.onClose && (
          <button type="button" aria-label="Закрыть список операций" title="Закрыть" onClick={props.onClose} className={btnClose}>
            <span aria-hidden="true">×</span>
          </button>
        )}
      </div>
      {/* порядок списка «Прибыли» — по дате платежа, а не сделки (R5); у списков под графиками подпись одна, над ними */}
      {props.dealDates && !props.narrow && <p className="-mt-1 mb-3 text-sm text-muted">{DEAL_ORDER_NOTE}</p>}
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
        <JournalCards
          items={items}
          lookups={props.lookups}
          baseCurrency={props.company.baseCurrency}
          timeZone={props.timeZone}
          busy={list.isFetching && !list.isFetchingNextPage}
          parts={parts}
          dealDates={props.dealDates}
          onOpenOperation={open}
        />
      ) : (
        <JournalTable
          items={items}
          columns={props.columns ?? (props.dealDates ? [...REPORT_OPERATION_COLUMNS, 'accrualDate'] : REPORT_OPERATION_COLUMNS)}
          wrap={false}
          narrow={props.narrow}
          dealDates={props.dealDates}
          caption={`Операции: ${props.title}`}
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
      {props.footnote && <p className="mt-3 text-sm text-muted">{props.footnote}</p>}
    </section>
  );
}
