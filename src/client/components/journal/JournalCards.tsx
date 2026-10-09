import { journalCardText } from '../../lib/journal-card';
import type { JournalItem } from '../../lib/queries';
import type { JournalLookups } from './JournalTable';

const AMOUNT_CLASS: Record<JournalItem['type'], string> = {
  income: 'text-income',
  expense: 'text-expense',
  transfer: 'text-transfer',
};

/**
 * Журнал на телефоне (§7 «Мобильная версия»): список карточек — сумма, статья, счёт, дата (и контрагент
 * с комментарием, если есть). Карточка — кнопка: открывает операцию в форме на весь экран; после закрытия
 * формы фокус возвращается на неё. Выделения и «Указать» здесь нет — они в таблице на компьютере.
 */
export function JournalCards(props: {
  items: JournalItem[];
  lookups: JournalLookups;
  baseCurrency: string;
  timeZone: string;
  today: string;
  busy: boolean;
  onOpenOperation: (item: JournalItem) => void;
}) {
  return (
    <ul aria-label="Операции" aria-busy={props.busy} className={`divide-y divide-field ${props.busy ? 'opacity-60' : ''}`}>
      {props.items.map((item) => {
        const c = journalCardText(item, props.lookups, props);
        return (
          <li key={item.id}>
            <button
              type="button"
              data-operation-id={item.id}
              onClick={() => props.onOpenOperation(item)}
              className="flex w-full items-start justify-between gap-3 rounded-lg py-3 text-left outline-none focus-visible:bg-field/60 focus-visible:ring-2 focus-visible:ring-focus"
            >
              <span className="min-w-0 flex-1">
                <span className="block truncate font-medium">{c.title}</span>
                <span className="block truncate text-sm text-muted">{c.account}</span>
                {c.details && <span className="block truncate text-xs text-muted">{c.details}</span>}
              </span>
              <span className="shrink-0 text-right tabular-nums">
                <span className={`block font-semibold ${AMOUNT_CLASS[item.type]}`}>
                  {item.type === 'transfer' && <span aria-hidden="true">⇄ </span>}
                  {c.amount}
                </span>
                {c.extra && <span className="block text-xs text-muted">{c.extra}</span>}
                <span className="block text-xs text-muted">{c.date}</span>
              </span>
            </button>
          </li>
        );
      })}
    </ul>
  );
}
