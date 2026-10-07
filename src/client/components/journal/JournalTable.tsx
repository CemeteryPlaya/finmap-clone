import type { MouseEvent, ReactNode } from 'react';
import { formatMoney } from '../../../shared/money';
import { canAssign, type AssignField } from '../../lib/journal-assign';
import { JOURNAL_COLUMNS, type JournalColumnId } from '../../lib/journal-columns';
import type { JournalSortKey, JournalSortOrder } from '../../lib/journal-filter';
import { dayLabel, dayOf, lineDimension, projectShare, signedMoney, splitLabel, timeLabel } from '../../lib/journal-format';
import type { Account, JournalItem } from '../../lib/queries';
import { SplitHint } from './SplitHint';

/** Названия справочников для ячеек журнала (архивные тоже: операции на них ссылаются). */
export interface JournalLookups {
  accounts: Map<number, Account>;
  categories: Map<number, string>;
  projects: Map<number, string>;
  counterparties: Map<number, string>;
}

export interface JournalTableProps {
  items: JournalItem[];
  columns: readonly JournalColumnId[];
  lookups: JournalLookups;
  baseCurrency: string;
  timeZone: string;
  today: string;
  /** Выбранные в фильтре проекты: у разбитых операций под суммой — «доля проекта». */
  projectFilter: readonly number[];
  sort: JournalSortKey;
  order: JournalSortOrder;
  onSort: (sort: JournalSortKey, order: JournalSortOrder) => void;
  busy: boolean;
  /**
   * Точка подключения формы операции (шаг 6): клик по строке открывает операцию. Пока не передаётся —
   * строка не реагирует на клик.
   */
  onOpenOperation?: (item: JournalItem) => void;
  /** «Указать» в пустой ячейке (§7): вызывается только там, где оно разрешено (canAssign). */
  renderAssign?: (item: JournalItem, field: AssignField) => ReactNode;
  /** Выделение строк для массовых действий: колонка флажков слева. */
  selection?: {
    selected: ReadonlySet<number>;
    onToggle: (id: number) => void;
    onToggleAll: (select: boolean) => void;
  };
}

const AMOUNT_CLASS: Record<JournalItem['type'], string> = {
  income: 'text-income',
  expense: 'text-expense',
  transfer: 'text-transfer',
};

const thClass = 'px-3 py-2 text-left text-xs font-semibold text-muted';
const tdClass = 'px-3 py-2 align-top';

function SortHeader(props: { label: string; column: JournalSortKey; sort: JournalSortKey; order: JournalSortOrder; onSort: JournalTableProps['onSort'] }) {
  const active = props.sort === props.column;
  const next: JournalSortOrder = active && props.order === 'desc' ? 'asc' : 'desc';
  return (
    <th scope="col" className={thClass} aria-sort={active ? (props.order === 'asc' ? 'ascending' : 'descending') : undefined}>
      <button type="button" onClick={() => props.onSort(props.column, next)} className="inline-flex items-center gap-1 rounded hover:text-ink">
        {props.label}
        <span aria-hidden="true">{active ? (props.order === 'asc' ? '↑' : '↓') : '↕'}</span>
      </button>
    </th>
  );
}

function lineHint(item: JournalItem, lookups: JournalLookups, currency: string): string[] {
  return item.lines.map((l) => {
    const category = l.categoryId === null ? 'без статьи' : (lookups.categories.get(l.categoryId) ?? '…');
    const project = l.projectId === null ? 'без проекта' : (lookups.projects.get(l.projectId) ?? '…');
    return `${category} · ${project} — ${formatMoney(l.amount, currency)}`;
  });
}

/** Ячейка статьи или проекта: название, «N категорий» с подсказкой у разбитой операции, «Указать» или пусто. */
function dimensionCell(item: JournalItem, key: 'categoryId' | 'projectId', names: Map<number, string>, hint: string[], assign: ReactNode): ReactNode {
  const d = lineDimension(item.lines, key);
  if (d.kind === 'many') return <SplitHint label={splitLabel(d.count, key === 'categoryId' ? 'category' : 'project')} lines={hint} />;
  return d.id === null ? assign : (names.get(d.id) ?? '…');
}

function AccountLine({ account, balance }: { account: Account | undefined; balance: number | null }) {
  return (
    <span className="block">
      <span className="block truncate">{account?.name ?? '…'}</span>
      {account && balance !== null && (
        <span className={`block text-xs tabular-nums ${balance < 0 ? 'text-expense' : 'text-muted'}`}>остаток {formatMoney(balance, account.currency)}</span>
      )}
    </span>
  );
}

export function JournalTable(props: JournalTableProps) {
  const { lookups, columns, selection } = props;
  const shown = JOURNAL_COLUMNS.filter((c) => columns.includes(c.id));
  const selectedCount = selection ? props.items.filter((i) => selection.selected.has(i.id)).length : 0;
  const allSelected = props.items.length > 0 && selectedCount === props.items.length;

  const onRowClick = (item: JournalItem) => (e: MouseEvent<HTMLTableRowElement>) => {
    // клики по настоящим элементам управления внутри строки — не открытие операции;
    // «2 статьи» (подсказка с tabIndex) — открывает: по §7 клик по ним открывает форму
    // события из портала (подсказка) всплывают по дереву React, но в DOM лежат вне строки — их игнорируем
    if (!e.currentTarget.contains(e.target as Node)) return;
    if ((e.target as HTMLElement).closest('button, a, input, label, select, [role="combobox"], [role="listbox"]')) return;
    props.onOpenOperation?.(item);
  };

  return (
    <div className="overflow-x-auto">
      <table aria-busy={props.busy} className={`w-full min-w-[56rem] border-collapse text-sm ${props.busy ? 'opacity-60' : ''}`}>
        <caption className="sr-only">Операции</caption>
        <thead>
          <tr className="border-b border-field">
            {selection && (
              <th scope="col" className={`${thClass} w-8`}>
                <input
                  type="checkbox"
                  aria-label="Выбрать все загруженные операции"
                  checked={allSelected}
                  ref={(el) => {
                    if (el) el.indeterminate = selectedCount > 0 && !allSelected;
                  }}
                  onChange={() => selection.onToggleAll(!allSelected)}
                />
              </th>
            )}
            {shown.map((c) =>
              c.id === 'date' || c.id === 'amount' ? (
                <SortHeader key={c.id} label={c.label} column={c.id} sort={props.sort} order={props.order} onSort={props.onSort} />
              ) : (
                <th key={c.id} scope="col" className={thClass}>
                  {c.label}
                </th>
              ),
            )}
          </tr>
        </thead>
        <tbody>
          {props.items.map((item) => {
            const account = lookups.accounts.get(item.accountId);
            const toAccount = item.toAccountId === null ? undefined : lookups.accounts.get(item.toAccountId);
            const currency = account?.currency ?? props.baseCurrency;
            const hint = lineHint(item, lookups, currency);
            const share = projectShare(item.lines, props.projectFilter);
            const assign = (field: AssignField) => (props.renderAssign && canAssign(item, field) ? props.renderAssign(item, field) : null);
            const cells: Record<JournalColumnId, ReactNode> = {
              date: (
                <time dateTime={item.paidAt} className="whitespace-nowrap">
                  {dayLabel(dayOf(item.paidAt, props.timeZone), props.today)}
                  <span className="ml-1 text-xs text-muted">{timeLabel(item.paidAt, props.timeZone)}</span>
                </time>
              ),
              amount: (
                <span className="block whitespace-nowrap tabular-nums">
                  <span className={`block font-semibold ${AMOUNT_CLASS[item.type]}`}>
                    {item.type === 'transfer' && <span aria-hidden="true">⇄ </span>}
                    {item.type === 'transfer' && (
                      <span className="sr-only">
                        Перевод: со счёта {account?.name ?? '…'} на счёт {toAccount?.name ?? '…'},{' '}
                      </span>
                    )}
                    {signedMoney(item.type, item.amount, currency)}
                  </span>
                  {item.type === 'transfer' && toAccount && toAccount.currency !== currency && item.toAmount !== null && (
                    <span className="block text-xs text-transfer">→ {formatMoney(item.toAmount, toAccount.currency)}</span>
                  )}
                  {currency !== props.baseCurrency && <span className="block text-xs text-muted">{formatMoney(item.baseAmount, props.baseCurrency)}</span>}
                  {share !== null && <span className="block text-xs text-muted">доля проекта: {formatMoney(share, currency)}</span>}
                </span>
              ),
              account: (
                <>
                  <AccountLine account={account} balance={item.balanceAfter} />
                  {item.type === 'transfer' && (
                    <span className="mt-1 flex gap-1">
                      <span aria-hidden="true" className="text-muted">
                        →
                      </span>
                      <AccountLine account={toAccount} balance={item.toBalanceAfter} />
                    </span>
                  )}
                </>
              ),
              counterparty: item.counterpartyId === null ? assign('counterparty') : (lookups.counterparties.get(item.counterpartyId) ?? '…'),
              category: dimensionCell(item, 'categoryId', lookups.categories, hint, assign('category')),
              project: dimensionCell(item, 'projectId', lookups.projects, hint, assign('project')),
              comment: item.comment && (
                <span className="line-clamp-2 max-w-xs break-words" title={item.comment}>
                  {item.comment}
                </span>
              ),
            };
            return (
              <tr
                key={item.id}
                // фокус сюда переводит «Указать» после выбора: кнопка в ячейке исчезает (план 5c)
                tabIndex={-1}
                data-operation-id={item.id}
                onClick={props.onOpenOperation ? onRowClick(item) : undefined}
                className={`border-b border-field outline-none last:border-0 focus:bg-field/60 ${props.onOpenOperation ? 'cursor-pointer hover:bg-field/60' : ''} ${selection?.selected.has(item.id) ? 'bg-income-soft/40' : ''}`}
              >
                {selection && (
                  <td className="p-0 align-top">
                    {/* label на всю ячейку: отступы вокруг флажка тоже его переключают, а не открывают операцию */}
                    <label className="flex h-full min-h-9 cursor-pointer items-start px-3 py-2">
                    <input
                      type="checkbox"
                      aria-label={[
                        `Выбрать операцию: ${dayLabel(dayOf(item.paidAt, props.timeZone), props.today)} ${timeLabel(item.paidAt, props.timeZone)}`,
                        signedMoney(item.type, item.amount, currency),
                        item.counterpartyId === null ? null : lookups.counterparties.get(item.counterpartyId),
                        item.comment,
                      ]
                        .filter(Boolean)
                        .join(', ')}
                      checked={selection.selected.has(item.id)}
                      onChange={() => selection.onToggle(item.id)}
                    />
                    </label>
                  </td>
                )}
                {shown.map((c) => (
                  <td key={c.id} className={tdClass}>
                    {cells[c.id]}
                  </td>
                ))}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
