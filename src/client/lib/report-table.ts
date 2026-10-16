import { formatDateRu } from '../../shared/dates';
import { formatMoney, MONEY_SCREEN_BEFORE } from '../../shared/money';
import { sharePercent, type ReportColumn, type ReportRow } from '../../shared/report-engine';

/** Раскрыты по умолчанию: группы «Поступления» и «Списания» (как у Finmap); неоперационные и подкатегории свёрнуты. */
export const DEFAULT_EXPANDED: readonly string[] = ['income', 'expense'];

/** Как выглядит строка таблицы (§4.1): остатки — фоном, группы — полужирным, неоперационные подстроки — приглушённо. */
export type LineTone = 'balance' | 'total' | 'group' | 'plain' | 'muted';

/** Строка таблицы отчёта на экране: строка ответа, глубина, раскрытие и группа для процентов. */
export interface TableLine {
  row: ReportRow;
  depth: number;
  expandable: boolean;
  expanded: boolean;
  /** Группа («Поступления» или «Списания»), от которой считаются проценты; null — без процентов. */
  group: ReportRow | null;
  tone: LineTone;
}

const TONE: Record<string, LineTone> = { 'balance:start': 'balance', 'balance:end': 'balance', nonop: 'balance', net: 'total', income: 'group', expense: 'group' };

/**
 * Строки таблицы сверху вниз (§4.1): раскрытые строки показывают детей сразу под собой. Группы и их строки получают
 * группу для процентов (§4.1 «Показать проценты»): у групп — 100 %, остатки и неоперационные — без процентов.
 */
export function tableLines(rows: readonly ReportRow[], expanded: ReadonlySet<string>): TableLine[] {
  const out: TableLine[] = [];
  const walk = (row: ReportRow, depth: number, group: ReportRow | null) => {
    const isGroup = row.kind === 'group';
    const own = isGroup ? row : group;
    const children = row.children ?? [];
    const open = children.length > 0 && expanded.has(row.id);
    out.push({ row, depth, expandable: children.length > 0, expanded: open, group: own, tone: TONE[row.id] ?? (row.id.startsWith('nonop:') ? 'muted' : 'plain') });
    if (open) for (const child of children) walk(child, depth + 1, own);
  };
  for (const row of rows) walk(row, 0, null);
  return out;
}

/** Сумма ячейки: «₸ 1 500», отрицательная — со знаком минус; нет значения — пусто. */
export function moneyText(value: number | null, currency: string): string {
  return value === null ? '' : formatMoney(value, currency, MONEY_SCREEN_BEFORE);
}

/** Доля строки в группе по колонке (index) или по «Итого» (null): «(12,50 %)»; без группы или при нуле — null. */
export function percentText(line: TableLine, index: number | null): string | null {
  if (!line.group) return null;
  const value = index === null ? line.row.total : (line.row.values[index] ?? null);
  const group = index === null ? line.group.total : (line.group.values[index] ?? null);
  const share = sharePercent(value, group);
  return share === null ? null : `(${share})`;
}

/** Название строки: архивная — с пометкой. */
export function rowLabel(row: ReportRow): string {
  return row.archived ? `${row.label} (архив)` : row.label;
}

/** Подсказка заголовка колонки: её точные границы («01.10.2026 – 31.10.2026»), видно у неполных колонок. */
export function columnHint(column: ReportColumn): string {
  return column.from === column.to ? formatDateRu(column.from) : `${formatDateRu(column.from)} – ${formatDateRu(column.to)}`;
}

/** Пояснения «?» у строк остатков и неоперационных подстрок (§4.1, как у Finmap; R4 — про архивные счета и курс). */
export const ROW_HELP: Readonly<Record<string, string>> = {
  'balance:start': 'Остаток на начало колонки на счетах, которые сегодня не в архиве. Суммы в валюте — по курсу последнего дня предыдущей колонки.',
  'balance:end': 'Остаток на конец колонки на счетах, которые сегодня не в архиве. Суммы в валюте — по курсу последнего дня колонки.',
  nonop: 'Изменения остатка, которые не входят в поступления и списания: стартовые остатки, переводы, счета вне отчёта и переоценка валюты.',
  'nonop:starting': 'Стартовые остатки счетов, открытых в этом периоде.',
  'nonop:transfers': 'Переводы между счетами отчёта и остальными счетами. Переводы внутри компании меняют остаток счёта, но по всем счетам в сумме равны нулю.',
  'nonop:excluded': 'Поступления и списания, которые не входят в отчёт: движение архивных счетов (без фильтра «Счета»).',
  'nonop:fx': 'Переоценка остатков в валюте по курсу на конец колонки и разница курсов в переводах.',
};
