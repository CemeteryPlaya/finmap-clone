import { formatDateRu } from '../../shared/dates';
import { formatMoney, MONEY_SCREEN_BEFORE } from '../../shared/money';
import { flattenRows, parseDrillRow, sharePercent, type FlatRow, type ReportColumn, type ReportRow } from '../../shared/report-engine';

/** Название строки (архивная — с пометкой): то же правило в таблице и в Excel. */
export { rowLabel } from '../../shared/report-engine';

/** Раскрыты по умолчанию: группы «Поступления» и «Списания» (как у Finmap); неоперационные и подкатегории свёрнуты. */
export const DEFAULT_EXPANDED: readonly string[] = ['income', 'expense'];

/** Как выглядит строка таблицы (§4.1): остатки — фоном, группы — полужирным, неоперационные подстроки — приглушённо. */
export type LineTone = 'balance' | 'total' | 'group' | 'plain' | 'muted';

/** Строка таблицы отчёта на экране: строка ответа, глубина, раскрытие, группа для процентов (flattenRows) и вид. */
export interface TableLine extends FlatRow {
  tone: LineTone;
}

/** «Прибыль» выделена, как «Чистый денежный поток» (§5.2). */
const TONE: Record<string, LineTone> = { 'balance:start': 'balance', 'balance:end': 'balance', nonop: 'balance', net: 'total', profit: 'total', income: 'group', expense: 'group' };

/**
 * Строки таблицы сверху вниз (§4.1): раскрытые строки показывают детей сразу под собой. Группы и их строки получают
 * группу для процентов (§4.1 «Показать проценты»): у групп — 100 %, остатки и неоперационные — без процентов.
 */
export function tableLines(rows: readonly ReportRow[], expanded: ReadonlySet<string>): TableLine[] {
  return flattenRows(rows, (id) => expanded.has(id)).map((line) => ({ ...line, tone: TONE[line.row.id] ?? (line.row.id.startsWith('nonop:') ? 'muted' : 'plain') }));
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

/** Подсказка заголовка колонки: её точные границы («01.10.2026 – 31.10.2026»), видно у неполных колонок. */
export function columnHint(column: ReportColumn): string {
  return column.from === column.to ? formatDateRu(column.from) : `${formatDateRu(column.from)} – ${formatDateRu(column.to)}`;
}

/** Ячейка строки раскрывается в список операций (§2.5): разрез, группы и «Чистый денежный поток»; остатки — нет. */
export function isDrillRow(row: ReportRow): boolean {
  return parseDrillRow(row.id) !== null;
}

/**
 * Заголовок списка под таблицей (§2.5): «{строка} за {колонка}» — «Бар за октябрь 2026», «Аренда за 13–19 окт»,
 * у «Итого» — «за весь период». Название месяца — со строчной, как у Finmap.
 */
export function cellTitle(row: ReportRow, column: ReportColumn | null): string {
  if (!column) return `${row.label} за весь период`;
  const label = /^[А-ЯЁ][а-яё]/.test(column.label) ? column.label[0]!.toLowerCase() + column.label.slice(1) : column.label;
  return `${row.label} за ${label}`;
}

export type CellMove = 'ArrowUp' | 'ArrowDown' | 'ArrowLeft' | 'ArrowRight' | 'Home' | 'End';

/**
 * Куда переходит фокус между ячейками-кнопками (R1, roving tabindex). grid[строка][колонка] — есть ли в ячейке кнопка
 * (строки остатков и ячейки без значения — false). Стрелки влево и вправо — к ближайшей кнопке в строке, вверх и вниз — к
 * ближайшей в той же колонке, Home и End — к первой и последней в строке. null — двигаться некуда.
 */
export function nextCell(grid: readonly (readonly boolean[])[], from: { row: number; col: number }, key: CellMove): { row: number; col: number } | null {
  const has = (row: number, col: number) => grid[row]?.[col] === true;
  const scan = (start: number, step: number, at: (i: number) => boolean, limit: number) => {
    for (let i = start; i >= 0 && i < limit; i += step) if (at(i)) return i;
    return null;
  };
  const width = grid[from.row]?.length ?? 0;
  switch (key) {
    case 'ArrowRight':
    case 'ArrowLeft': {
      const step = key === 'ArrowRight' ? 1 : -1;
      const col = scan(from.col + step, step, (c) => has(from.row, c), width);
      return col === null ? null : { row: from.row, col };
    }
    case 'ArrowDown':
    case 'ArrowUp': {
      const step = key === 'ArrowDown' ? 1 : -1;
      const row = scan(from.row + step, step, (r) => has(r, from.col), grid.length);
      return row === null ? null : { row, col: from.col };
    }
    case 'Home':
    case 'End': {
      const col = key === 'Home' ? scan(0, 1, (c) => has(from.row, c), width) : scan(width - 1, -1, (c) => has(from.row, c), width);
      return col === null || col === from.col ? null : { row: from.row, col };
    }
  }
}

/** Пояснения «?» у строк остатков и неоперационных подстрок (§4.1, как у Finmap; R4 — про архивные счета и курс). */
export const ROW_HELP: Readonly<Record<string, string>> = {
  'balance:start': 'Остатки неархивных сегодня счетов (или выбранных в фильтре «Счета») на последний день предыдущей колонки по курсу этого дня; будущие даты — по сегодняшнему курсу.',
  'balance:end': 'Остатки неархивных сегодня счетов (или выбранных в фильтре «Счета») на последний день колонки по курсу этого дня; будущие даты — по сегодняшнему курсу.',
  nonop: 'Изменения остатка, которые не входят в поступления и списания: стартовые остатки, переводы, счета вне отчёта и переоценка валюты.',
  'nonop:starting': 'Стартовые остатки счетов, открытых в этом периоде.',
  'nonop:transfers': 'Переводы между счетами отчёта и остальными счетами. Переводы внутри компании меняют остаток счёта, но по всем счетам в сумме равны нулю.',
  'nonop:excluded': 'Поступления и списания, которые не входят в отчёт: движение архивных счетов (без фильтра «Счета»).',
  'nonop:fx': 'Переоценка остатков в валюте по курсу на конец колонки и разница курсов в переводах.',
  'expense:stock:cogs': 'Себестоимость проданных товаров по FIFO — по документам склада «Продажа» с датой в колонке. Оплаты закупок при этом в расходы не входят.',
  'expense:stock:writeoff': 'Себестоимость списанного товара по FIFO — по документам склада «Списание» с датой в колонке.',
};

/**
 * Предупреждение под «Прибылью» (§5.3): «У 1 продажи…», «У 2 продаж…», «У 21 продажи…» — себестоимость продаж
 * «Нет партии» не определена.
 */
export function noBatchText(count: number): string {
  const one = count % 10 === 1 && count % 100 !== 11;
  return `У ${count} ${one ? 'продажи' : 'продаж'} себестоимость не определена — прибыль завышена`;
}
