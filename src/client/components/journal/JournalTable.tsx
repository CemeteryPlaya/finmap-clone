import type { MouseEvent, ReactNode } from 'react';
import { formatDateShortRu } from '../../../shared/dates';
import { formatMoney, MONEY_SCREEN } from '../../../shared/money';
import { badgeClass } from '../ui';
import { canAssign, type AssignField } from '../../lib/journal-assign';
import { JOURNAL_COLUMNS, type JournalColumnId } from '../../lib/journal-columns';
import type { JournalSortKey, JournalSortOrder } from '../../lib/journal-filter';
import { dealDay, journalDateParts, lineDimension, projectShare, signedMoney, splitLabel, type CategoryInfo } from '../../lib/journal-format';
import { SYSTEM_BADGE } from '../../lib/operation-options';
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
  /** Подпись таблицы для программ чтения с экрана; по умолчанию «Операции» (у двух таблиц на странице — разные). */
  caption?: string;
  items: JournalItem[];
  columns: readonly JournalColumnId[];
  lookups: JournalLookups;
  baseCurrency: string;
  timeZone: string;
  today: string;
  /** Выбранные в фильтре проекты: у разбитых операций под суммой — «доля проекта». */
  projectFilter: readonly number[];
  /** Сортировка по дате и сумме; без onSort заголовки — обычный текст (список под отчётом «Аналитики»). */
  sort?: JournalSortKey;
  order?: JournalSortOrder;
  onSort?: (sort: JournalSortKey, order: JournalSortOrder) => void;
  busy: boolean;
  /**
   * Список под отчётом (§2.5 спецификации «Аналитика»): у операции, в ячейку которой вошли не все строки, — сумма этих строк
   * в валюте счёта вместо суммы операции и пометка «часть операции».
   */
  parts?: ReadonlyMap<number, number>;
  /** «Показывать полностью» (`journal.wrap`): длинный текст — до двух строк, иначе одна строка с подсказкой. */
  wrap: boolean;
  /** Узкая таблица (списки под графиками «Аналитики» в две колонки): меньше колонок и меньшая минимальная ширина. */
  narrow?: boolean;
  /**
   * Список под «Прибылью» (§5.2): первые колонки — «Дата сделки» (без неё — день платежа), «Сумма», «Движение денег»
   * (дата и время платежа).
   */
  dealDates?: boolean;
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
   * Полоса массовых действий (§5.5 этапа 1.5): пока есть выделение, стоит над строкой заголовков (как в Finmap);
   * заголовки остаются на месте и доступны.
   */
  bulkBar?: ReactNode;
}

const AMOUNT_CLASS: Record<JournalItem['type'], string> = {
  income: 'text-income',
  expense: 'text-expense-strong',
  transfer: 'text-transfer',
};

const thClass = 'px-3 text-left text-xs font-semibold text-muted';
/** Порядок первых колонок списка «Прибыли» (§5.2): «Дата сделки», «Сумма», «Движение денег». */
const DEAL_ORDER: readonly JournalColumnId[] = ['accrualDate', 'amount', 'date'];

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

function SortHeader(props: {
  label: string;
  column: JournalSortKey;
  sort: JournalSortKey;
  order: JournalSortOrder;
  onSort: (sort: JournalSortKey, order: JournalSortOrder) => void;
  className?: string;
}) {
  const active = props.sort === props.column;
  const next: JournalSortOrder = active && props.order === 'desc' ? 'asc' : 'desc';
  return (
    <th scope="col" className={`${thClass} ${props.className ?? ''}`} aria-sort={active ? (props.order === 'asc' ? 'ascending' : 'descending') : undefined}>
      <button
        type="button"
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
  return <span className={badgeClass}>{SYSTEM_BADGE}</span>;
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
  return <span className={balance < 0 ? 'text-expense-strong' : 'text-muted'}>{formatMoney(balance, account.currency, MONEY_SCREEN)}</span>;
}

export function JournalTable(props: JournalTableProps) {
  const { lookups, columns, selection, wrap } = props;
  // «Прибыль» (§5.2): «Дата сделки» первой, затем сумма и «Движение денег» (дата платежа), как у Finmap
  // (в узком списке «Движение денег» — под «Датой сделки» в первой колонке, порядок обычный, R8)
  const order = props.dealDates && !props.narrow ? [...DEAL_ORDER.map((id) => JOURNAL_COLUMNS.find((c) => c.id === id)!), ...JOURNAL_COLUMNS.filter((c) => !DEAL_ORDER.includes(c.id))] : JOURNAL_COLUMNS;
  const shown = order.filter((c) => columns.includes(c.id));
  // узкий список (две колонки, R8): «Движение денег» не отдельная колонка, а вторая строка под «Датой сделки»
  const stacked = !!props.dealDates && !!props.narrow;
  const label = (c: (typeof JOURNAL_COLUMNS)[number]) => (props.dealDates && c.id === 'date' ? (stacked ? 'Дата сделки' : 'Движение денег') : c.label);
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
    // полоса действий — над строкой заголовков, вне горизонтальной прокрутки таблицы (§5.5): при узком окне таблица уезжает вбок, полоса — нет
    <div>
      {props.bulkBar}
      <div className="overflow-x-auto">
      <table aria-busy={props.busy} className={`w-full ${props.narrow ? 'min-w-[32rem]' : 'min-w-[56rem]'} table-fixed border-collapse text-sm ${props.busy ? 'opacity-60' : ''}`}>
        <caption className="sr-only">{props.caption ?? 'Операции'}</caption>
        <thead>
          <tr className="h-12 border-b border-field">
            {selection && (
              <th scope="col" className={`${thClass} w-[2.75rem]`}>
                <input
                  type="checkbox"
                  data-select-all=""
                  aria-label="Выбрать все загруженные операции"
                  checked={allSelected}
                  ref={(el) => {
                    if (el) el.indeterminate = selectedCount > 0 && !allSelected;
                  }}
                  // есть выделение (в том числе частичное, «минус») — снимает его; нет выделения — выбирает все загруженные
                  onChange={() => selection.onToggleAll(selectedCount === 0)}
                  className={checkboxClass}
                />
              </th>
            )}
            {shown.map((c) =>
              (c.id === 'date' || c.id === 'amount') && props.onSort ? (
                <SortHeader key={c.id} label={label(c)} column={c.id} sort={props.sort ?? 'date'} order={props.order ?? 'desc'} onSort={props.onSort} className={COLUMN_WIDTH[c.id]} />
              ) : (
                <th key={c.id} scope="col" className={`${thClass} ${COLUMN_WIDTH[c.id] ?? ''}`}>
                  {label(c)}
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
            const part = props.parts?.get(item.id);
            // «Дата сделки» в «Прибыли» — и у операции без неё: день платежа (§3.1)
            const deal = props.dealDates ? dealDay(item, props.timeZone) : item.accrualDate;
            const signed = signedMoney(item.type, part ?? item.amount, currency);
            const assign = (field: AssignField) => (props.renderAssign && canAssign(item, field) ? props.renderAssign(item, field) : null);
            const dateText = stacked ? (
              <span className="block whitespace-nowrap text-left">
                <time dateTime={deal!} className="block">
                  {formatDateShortRu(deal!)}
                </time>
                {/* вторая строка короткая — только день платежа с приглушённым «оплата»; полный текст в title (I-1) */}
                <time dateTime={item.paidAt} title={`Движение денег: ${when.date}, ${when.time}`} className="block truncate text-xs text-muted">
                  оплата {when.date}
                </time>
              </span>
            ) : (
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
                  aria-label={`Открыть операцию: ${stacked ? `дата сделки ${formatDateShortRu(deal!)}, движение денег ${when.date}, ${when.time}` : `${when.date}, ${when.time}`}, ${signed}${part === undefined ? '' : ', часть операции'}`}
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
                  {currency !== props.baseCurrency && part === undefined && (
                    <span className="block text-xs text-muted">{formatMoney(item.baseAmount, props.baseCurrency, MONEY_SCREEN)}</span>
                  )}
                  {share !== null && <span className="block text-xs text-muted">доля проекта: {formatMoney(share, currency, MONEY_SCREEN)}</span>}
                  {part !== undefined && <span className="block text-xs text-muted">часть операции</span>}
                </span>
              ),
              accrualDate: deal && (
                <time dateTime={deal} className="whitespace-nowrap">
                  {formatDateShortRu(deal)}
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
