import { formatDateShortRu } from '../../../shared/dates';
import { journalCardText } from '../../lib/journal-card';
import { dealDay } from '../../lib/journal-format';
import type { JournalItem } from '../../lib/queries';
import type { JournalLookups } from './JournalTable';

const AMOUNT_CLASS: Record<JournalItem['type'], string> = {
  income: 'text-income',
  expense: 'text-expense-strong',
  transfer: 'text-transfer',
};

/**
 * Журнал на телефоне (§8.4 этапа 1.5, как в Finmap): карточка — дата слева и сумма справа, затем контрагент, счёт и
 * мелко категория. Карточка — кнопка «Открыть операцию»: форма на весь экран, после закрытия фокус — на карточке.
 * Выделения и «Указать» здесь нет — они в таблице на компьютере.
 */
export function JournalCards(props: {
  items: JournalItem[];
  lookups: JournalLookups;
  baseCurrency: string;
  timeZone: string;
  busy: boolean;
  /** Список под отчётом «Аналитики»: сумма строк ячейки у операции, вошедшей частью, и пометка «часть операции». */
  parts?: ReadonlyMap<number, number>;
  /** Список под «Прибылью» (§5.2): дата сделки (без неё — день платежа) и под ней дата платежа. */
  dealDates?: boolean;
  /** «Выписка по счету» (§6): сумма и остаток — по этому счёту, у перевода — «Перевод: {другой счёт}». */
  statementAccountId?: number;
  /** Имя списка для программ чтения с экрана; по умолчанию «Операции» (у двух списков на странице — разные). */
  label?: string;
  onOpenOperation: (item: JournalItem) => void;
}) {
  return (
    <ul aria-label={props.label ?? 'Операции'} aria-busy={props.busy} className={`divide-y divide-field ${props.busy ? 'opacity-60' : ''}`}>
      {props.items.map((item) => {
        const part = props.parts?.get(item.id);
        const c = journalCardText(part === undefined ? item : { ...item, amount: part }, props.lookups, props);
        // в выписке цвет суммы — по движению по счёту: перевод на счёт — как доход, со счёта — как расход
        const tone = props.statementAccountId === undefined ? AMOUNT_CLASS[item.type] : c.amount.startsWith('+') ? AMOUNT_CLASS.income : AMOUNT_CLASS.expense;
        return (
          <li key={item.id}>
            <button
              type="button"
              data-operation-id={item.id}
              title="Открыть операцию"
              onClick={() => props.onOpenOperation(item)}
              className="block w-full rounded-lg py-3 text-left outline-none focus-visible:bg-field/60 focus-visible:ring-2 focus-visible:ring-focus"
            >
              <span className="flex items-start justify-between gap-3">
                <span data-card-line="date" className="pt-0.5 text-sm text-muted">
                  {props.dealDates ? (
                    <>
                      <span className="block">Сделка: {formatDateShortRu(dealDay(item, props.timeZone))}</span>
                      <span className="block text-xs">Деньги: {c.date}</span>
                    </>
                  ) : (
                    c.date
                  )}
                </span>
                <span className="shrink-0 text-right tabular-nums">
                  <span data-card-line="amount" className={`block font-semibold ${tone}`}>
                    {item.type === 'transfer' && (
                      <>
                        <span aria-hidden="true">⇄ </span>
                        <span className="sr-only">Перевод </span>
                      </>
                    )}
                    {c.amount}
                  </span>
                  {part === undefined ? c.extra && <span className="block text-xs text-muted">{c.extra}</span> : <span className="block text-xs text-muted">часть операции</span>}
                </span>
              </span>
              {c.counterparty && (
                <span data-card-line="counterparty" className="block truncate">
                  {c.counterparty}
                </span>
              )}
              <span data-card-line="account" className="block truncate text-sm text-muted">
                {c.account}
              </span>
              {c.category && (
                <span data-card-line="category" className="block truncate text-xs text-muted">
                  {c.category}
                </span>
              )}
            </button>
          </li>
        );
      })}
    </ul>
  );
}
