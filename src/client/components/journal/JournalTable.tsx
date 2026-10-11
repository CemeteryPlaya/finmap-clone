import type { MouseEvent, ReactNode } from 'react';
import { formatDateShortRu } from '../../../shared/dates';
import { formatMoney, MONEY_SCREEN } from '../../../shared/money';
import { canAssign, type AssignField } from '../../lib/journal-assign';
import { JOURNAL_COLUMNS, type JournalColumnId } from '../../lib/journal-columns';
import type { JournalSortKey, JournalSortOrder } from '../../lib/journal-filter';
import { journalDateParts, lineDimension, projectShare, signedMoney, splitLabel, type CategoryInfo } from '../../lib/journal-format';
import type { Account, JournalItem } from '../../lib/queries';
import { SplitHint } from './SplitHint';

export type { CategoryInfo };

/** Справочники для ячеек журнала (архивные тоже: операции на них ссылаются). */
export interface JournalLookups {
  accounts: Map<number, Account>;
  categories: Map<number, CategoryInfo>;
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
  /** «Показывать полностью» (`journal.wrap`): длинный текст — до двух строк, иначе одна строка с подсказкой. */
  wrap: boolean;
  /**
   * Открыть операцию в форме: клик по строке или кнопка в ячейке даты (с клавиатуры).
   * Не передан — строка не реагирует на клик.
   */
  onOpenOperation?: (item: JournalItem) => void;
  /** «Указать» в пустой ячейке: вызывается только там, где оно разрешено (canAssign). */
  renderAssign?: (item: JournalItem, field: AssignField) => ReactNode;
  /** Выделение строк для массовых действий: колонка флажков слева. */
  selection?: {
    selected: ReadonlySet<number>;
    onToggle: (id: number) => void;
    onToggleAll: (select: boolean) => void;
  };
  /**
   * Полоса массовых действий (§5.5 этапа 1.5): пока есть выделение, лежит поверх строки заголовков. Заголовки
   * остаются в таблице для программ чтения, их кнопки на это время выходят из порядка Tab.
   */
  bulkBar?: ReactNode;
}

const AMOUNT_CLASS: Record<JournalItem['type'], string> = {
  income: 'text-income',
  expense: 'text-expense',
  transfer: 'text-transfer',
};

const thClass = 'px-3 text-left text-xs font-semibold text-muted';
/**
 * Раскладка `table-fixed` (H1 финала 1.5-2a): узкие колонки — фиксированной ширины, текстовые делят остаток поровну,
 * а длинный текст обрезается внутри колонки (truncate + title), не раздвигая таблицу. Так при 1440 px
 * все колонки по умолчанию помещаются без горизонтальной прокрутки.
 */
const COLUMN_WIDTH: Partial<Record<JournalColumnId, string>> = {
  date: 'w-[7.5rem]',
  amount: 'w-[9rem]',
  accrualDate: 'w-[7.5rem]',
};
/** Строки одной высоты (§5.2 этапа 1.5): высота ячейки работает как минимальная, содержимое — по центру. */
const tdClass = 'h-[4.5rem] px-3 py-2 align-middle';
/** Флажки выделения (§5.2): 18 px, цвет акцента. */
const checkboxClass = 'size-[18px] shrink-0 cursor-pointer accent-income';

function SortHeader(props: { label: string; column: JournalSortKey; sort: JournalSortKey; order: JournalSortOrder; onSort: JournalTableProps['onSort']; className?: string; covered?: boolean }) {
  const active = props.sort === props.column;
  const next: JournalSortOrder = active && props.order === 'desc' ? 'asc' : 'desc';
  return (
    <th scope="col" className={`${thClass} ${props.className ?? ''}`} aria-sort={active ? (props.order === 'asc' ? 'ascending' : 'descending') : undefined}>
      <button
        type="button"
        tabIndex={props.covered ? -1 : undefined}
        onClick={() => props.onSort(props.column, next)}
        className="group inline-flex items-center gap-1 rounded hover:text-ink focus-visible:outline-2 focus-visible:outline-focus"
      >
        {props.label}
        {/* стрелка — только у активной колонки; у остальных «↕» появляется при наведении и фокусе (§5.2) */}
        <span aria-hidden="true" className={active ? '' : 'opacity-0 group-hover:opacity-100 group-focus-visible:opacity-100'}>
          {active ? (props.order === 'asc' ? '↑' : '↓') : '↕'}
        </span>
      </button>
    </th>
  );
}

/**
 * Текст ячейки: одна строка с обрезкой и подсказкой title; при «Показывать полностью» — до двух строк.
 * Без `block` рядом с `line-clamp-2`: в Tailwind 4 `.block` идёт в CSS после `.line-clamp-2` и перебил бы
 * `display: -webkit-box` — обрезки по строкам не было бы.
 */
function CellText({ text, wrap }: { text: string; wrap: boolean }) {
  return (
    <span title={text} className={`min-w-0 ${wrap ? 'line-clamp-2 break-words' : 'block truncate'}`}>
      {text}
    </span>
  );
}

/** «системная» — у категории с собственным systemKey (§5.2 этапа 1.5). */
function SystemBadge() {
  return <span className="shrink-0 rounded bg-income-soft px-1.5 py-0.5 text-[11px] font-medium text-income-strong">системная</span>;
}

function lineHint(item: JournalItem, lookups: JournalLookups, currency: string): string[] {
  return item.lines.map((l) => {
    const category = l.categoryId === null ? 'без категории' : (lookups.categories.get(l.categoryId)?.name ?? '…');
    const project = l.projectId === null ? 'без проекта' : (lookups.projects.get(l.projectId) ?? '…');
    return `${category} · ${project} — ${formatMoney(l.amount, currency, MONEY_SCREEN)}`;
  });
}

/** Ячейка категории или проекта: значение, «N категорий» с подсказкой у разбитой операции, «Указать» или пусто. */
function dimensionCell(item: JournalItem, key: 'categoryId' | 'projectId', value: (id: number) => ReactNode, hint: string[], assign: ReactNode): ReactNode {
  const d = lineDimension(item.lines, key);
  if (d.kind === 'many') return <SplitHint label={splitLabel(d.count, key === 'categoryId' ? 'category' : 'project')} lines={hint} />;
  return d.id === null ? assign : value(d.id);
}

/** Остаток после операции в валюте счёта, без слова «остаток» (§5.2); отрицательный — красным. */
function Balance({ account, balance }: { account: Account | undefined; balance: number | null }) {
  if (!account || balance === null) return null;
  return <span className={balance < 0 ? 'text-expense' : 'text-muted'}>{formatMoney(balance, account.currency, MONEY_SCREEN)}</span>;
}

export function JournalTable(props: JournalTableProps) {
  const { lookups, columns, selection, wrap } = props;
  const covered = props.bulkBar !== undefined;
  const shown = JOURNAL_COLUMNS.filter((c) => columns.includes(c.id));
  const selectedCount = selection ? props.items.filter((i) => selection.selected.has(i.id)).length : 0;
  const allSelected = props.items.length > 0 && selectedCount === props.items.length;

  const onRowClick = (item: JournalItem) => (e: MouseEvent<HTMLTableRowElement>) => {
    // клики по настоящим элементам управления внутри строки — не открытие операции;
    // «2 категории» (подсказка с tabIndex) — открывает: по §7 клик по ним открывает форму
    // события из портала (подсказка) всплывают по дереву React, но в DOM лежат вне строки — их игнорируем
    if (!e.currentTarget.contains(e.target as Node)) return;
    if ((e.target as HTMLElement).closest('button, a, input, label, select, [role="combobox"], [role="listbox"]')) return;
    props.onOpenOperation?.(item);
  };

  const categoryName = (id: number): ReactNode => {
    const c = lookups.categories.get(id);
    if (!c) return '…';
    return (
      <span className="flex min-w-0 items-center gap-1.5">
        <CellText text={c.name} wrap={wrap} />
        {c.systemKey && <SystemBadge />}
      </span>
    );
  };
  const projectName = (id: number): ReactNode => <CellText text={lookups.projects.get(id) ?? '…'} wrap={wrap} />;

  return (
    // полоса действий — вне горизонтальной прокрутки таблицы (§5.5): при узком окне таблица уезжает вбок, полоса — нет
    <div className="relative">
      {props.bulkBar && <div className="absolute inset-x-0 top-0 z-10">{props.bulkBar}</div>}
      <div className="overflow-x-auto">
      <table aria-busy={props.busy} className={`w-full min-w-[56rem] table-fixed border-collapse text-sm ${props.busy ? 'opacity-60' : ''}`}>
        <caption className="sr-only">Операции</caption>
        <thead>
          <tr className="h-12 border-b border-field">
            {selection && (
              <th scope="col" className={`${thClass} w-[2.75rem]`}>
                <input
                  type="checkbox"
                  data-select-all=""
                  tabIndex={covered ? -1 : undefined}
                  aria-label="Выбрать все загруженные операции"
                  checked={allSelected}
                  ref={(el) => {
                    if (el) el.indeterminate = selectedCount > 0 && !allSelected;
                  }}
                  onChange={() => selection.onToggleAll(!allSelected)}
                  className={checkboxClass}
                />
              </th>
            )}
            {shown.map((c) =>
              c.id === 'date' || c.id === 'amount' ? (
                <SortHeader key={c.id} label={c.label} column={c.id} sort={props.sort} order={props.order} onSort={props.onSort} className={COLUMN_WIDTH[c.id]} covered={covered} />
              ) : (
                <th key={c.id} scope="col" className={`${thClass} ${COLUMN_WIDTH[c.id] ?? ''}`}>
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
            const when = journalDateParts(item.paidAt, props.timeZone, props.today);
            const signed = signedMoney(item.type, item.amount, currency);
            const assign = (field: AssignField) => (props.renderAssign && canAssign(item, field) ? props.renderAssign(item, field) : null);
            const dateText = (
              <time dateTime={item.paidAt} className="block whitespace-nowrap text-left">
                <span className="block">{when.date}</span>
                <span className="block text-xs text-muted">{when.time}</span>
              </time>
            );
            const cells: Record<JournalColumnId, ReactNode> = {
              date: props.onOpenOperation ? (
                // с клавиатуры операция открывается кнопкой в ячейке даты (Tab, затем Enter)
                <button
                  type="button"
                  data-row-open=""
                  onClick={() => props.onOpenOperation!(item)}
                  aria-label={`Открыть операцию: ${when.date}, ${when.time}, ${signed}`}
                  className="rounded text-left hover:underline focus-visible:outline-2 focus-visible:outline-focus"
                >
                  {dateText}
                </button>
              ) : (
                dateText
              ),
              amount: (
                <span className="block whitespace-nowrap tabular-nums">
                  <span className={`block ${AMOUNT_CLASS[item.type]}`}>
                    {item.type === 'transfer' && <span aria-hidden="true">⇄ </span>}
                    {item.type === 'transfer' && (
                      <span className="sr-only">
                        Перевод: со счёта {account?.name ?? '…'} на счёт {toAccount?.name ?? '…'},{' '}
                      </span>
                    )}
                    {signed}
                  </span>
                  {item.type === 'transfer' && toAccount && toAccount.currency !== currency && item.toAmount !== null && (
                    <span className="block text-xs text-transfer">→ {formatMoney(item.toAmount, toAccount.currency, MONEY_SCREEN)}</span>
                  )}
                  {currency !== props.baseCurrency && <span className="block text-xs text-muted">{formatMoney(item.baseAmount, props.baseCurrency, MONEY_SCREEN)}</span>}
                  {share !== null && <span className="block text-xs text-muted">доля проекта: {formatMoney(share, currency, MONEY_SCREEN)}</span>}
                </span>
              ),
              accrualDate: item.accrualDate && (
                <time dateTime={item.accrualDate} className="whitespace-nowrap">
                  {formatDateShortRu(item.accrualDate)}
                </time>
              ),
              account: (
                <span className="block">
                  <CellText text={item.type === 'transfer' ? `${account?.name ?? '…'} → ${toAccount?.name ?? '…'}` : (account?.name ?? '…')} wrap={wrap} />
                  <span className="block truncate whitespace-nowrap text-xs tabular-nums">
                    <Balance account={account} balance={item.balanceAfter} />
                    {item.type === 'transfer' && toAccount && item.toBalanceAfter !== null && (
                      <>
                        <span aria-hidden="true" className="text-muted">
                          {' → '}
                        </span>
                        <Balance account={toAccount} balance={item.toBalanceAfter} />
                      </>
                    )}
                  </span>
                </span>
              ),
              counterparty: item.counterpartyId === null ? assign('counterparty') : <CellText text={lookups.counterparties.get(item.counterpartyId) ?? '…'} wrap={wrap} />,
              category: dimensionCell(item, 'categoryId', categoryName, hint, assign('category')),
              project: dimensionCell(item, 'projectId', projectName, hint, assign('project')),
              comment: item.comment && <CellText text={item.comment} wrap={wrap} />,
            };
            return (
              <tr
                key={item.id}
                data-operation-id={item.id}
                onClick={props.onOpenOperation ? onRowClick(item) : undefined}
                className={`border-b border-field last:border-0 ${props.onOpenOperation ? 'cursor-pointer hover:bg-field/60' : ''} ${selection?.selected.has(item.id) ? 'bg-income-soft/40' : ''}`}
              >
                {selection && (
                  <td className="h-[4.5rem] p-0 align-middle">
                    {/* label на всю ячейку: отступы вокруг флажка тоже его переключают, а не открывают операцию */}
                    <label className="flex h-[4.5rem] cursor-pointer items-center px-3">
                      <input
                        type="checkbox"
                        aria-label={[
                          `Выбрать операцию: ${when.date}, ${when.time}`,
                          signed,
                          item.counterpartyId === null ? null : lookups.counterparties.get(item.counterpartyId),
                          item.comment,
                        ]
                          .filter(Boolean)
                          .join(', ')}
                        checked={selection.selected.has(item.id)}
                        onChange={() => selection.onToggle(item.id)}
                        className={checkboxClass}
                      />
                    </label>
                  </td>
                )}
                {shown.map((c) => (
                  <td key={c.id} data-column={c.id} className={tdClass}>
                    {cells[c.id]}
                  </td>
                ))}
              </tr>
            );
          })}
        </tbody>
      </table>
      </div>
    </div>
  );
}
