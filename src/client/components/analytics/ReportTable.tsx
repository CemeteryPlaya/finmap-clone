import { useState, type KeyboardEvent } from 'react';
import type { ReportColumn, ReportData, ReportRow } from '../../lib/analytics';
import { cellTitle, columnHint, isDrillRow, moneyText, nextCell, percentText, ROW_HELP, rowLabel, tableLines, type CellMove, type LineTone, type TableLine } from '../../lib/report-table';
import { HelpButton } from '../HelpButton';
import { ChevronIcon } from '../icons';

/** Фон строки и закреплённой первой колонки: у закреплённой ячейки фон непрозрачный, иначе под ней видны прокрученные. */
const ROW_BG: Record<LineTone, string> = { balance: 'bg-field', total: 'bg-field', group: 'bg-card', plain: 'bg-card', muted: 'bg-card' };
const LABEL_TEXT: Record<LineTone, string> = { balance: 'font-semibold', total: 'font-semibold', group: 'font-bold', plain: 'font-normal', muted: 'text-sm font-normal text-muted' };
const MOVES: readonly string[] = ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Home', 'End'] satisfies CellMove[];

function Amount(props: { value: number | null; currency: string; percent: string | null }) {
  if (props.value === null) return null;
  return (
    <>
      <span className={`block ${props.value < 0 ? 'text-expense-strong' : ''}`}>{moneyText(props.value, props.currency)}</span>
      {props.percent && <span className="block text-xs text-muted">{props.percent}</span>}
    </>
  );
}

/** Ключ ячейки: id строки и ключ колонки (`total` — «Итого»); по нему фокус возвращается в ячейку после закрытия списка. */
export const cellKey = (rowId: string, col: string) => `${rowId}|${col}`;

/**
 * Таблица отчёта (§2.2, §4.1 спецификации «Аналитика»): «Название», колонки шага, «Итого». Первая колонка закреплена,
 * остальные прокручиваются по горизонтали внутри блока; отрицательные суммы — красным; суммы — в базовой валюте.
 * Строки с детьми раскрываются кнопкой с aria-expanded; у неоперационных строк — «?» с пояснением. Ячейки строк разреза,
 * групп и «Чистого денежного потока» — кнопки «{строка} за {колонка}»: открывают список операций под таблицей (§2.5).
 * Кнопки ячеек — одна точка Tab (roving tabindex, R1): стрелки, Home и End двигают фокус между ними, Enter и пробел
 * открывают список. Точка Tab — ячейка, на которой был фокус, иначе открытая ячейка, иначе первая.
 */
export function ReportTable(props: {
  caption: string;
  data: ReportData;
  percent: boolean;
  expanded: ReadonlySet<string>;
  onToggle: (rowId: string) => void;
  busy: boolean;
  /** Ячейка с открытым списком операций. */
  active: { row: string; col: string } | null;
  onCell: (row: ReportRow, column: ReportColumn | null) => void;
}) {
  const { columns, meta } = props.data;
  const lines = tableLines(props.data.rows, props.expanded);
  const cellClass = 'px-3 py-2 text-right align-middle whitespace-nowrap tabular-nums';
  const [focused, setFocused] = useState<string | null>(null);

  // колонки ячеек: колонки шага и «Итого»; кнопка есть у строк раскрытия в операции, где есть значение
  const colKey = (c: number) => (c < columns.length ? columns[c]!.key : 'total');
  const valueAt = (row: ReportRow, c: number) => (c < columns.length ? (row.values[c] ?? null) : row.total);
  const grid = lines.map((line) => Array.from({ length: columns.length + 1 }, (_, c) => isDrillRow(line.row) && valueAt(line.row, c) !== null));
  const positions = new Map<string, { row: number; col: number }>();
  grid.forEach((cells, r) => cells.forEach((has, c) => has && positions.set(cellKey(lines[r]!.row.id, colKey(c)), { row: r, col: c })));
  const first = positions.keys().next().value ?? null;
  const activeKey = props.active ? cellKey(props.active.row, props.active.col) : null;
  const stop = [focused, activeKey].find((k) => k !== null && positions.has(k)) ?? first;

  const onKeyDown = (e: KeyboardEvent<HTMLTableElement>) => {
    if (e.altKey || e.ctrlKey || e.metaKey || !MOVES.includes(e.key)) return;
    const key = e.target instanceof HTMLElement ? e.target.dataset.cell : undefined;
    const from = key === undefined ? undefined : positions.get(key);
    if (!from) return;
    e.preventDefault();
    const to = nextCell(grid, from, e.key as CellMove);
    if (!to) return;
    const target = cellKey(lines[to.row]!.row.id, colKey(to.col));
    e.currentTarget.querySelector<HTMLElement>(`[data-cell="${CSS.escape(target)}"]`)?.focus();
  };

  const renderLabel = (line: TableLine) => {
    const label = rowLabel(line.row);
    const help = ROW_HELP[line.row.id];
    return (
      <span className="flex items-center gap-1.5" style={{ paddingLeft: `${line.depth * 1.25}rem` }}>
        {line.expandable ? (
          <button
            type="button"
            aria-expanded={line.expanded}
            onClick={() => props.onToggle(line.row.id)}
            className="inline-flex items-center gap-1 rounded text-left hover:underline focus-visible:outline-2 focus-visible:outline-focus"
          >
            {label}
            <ChevronIcon up={line.expanded} />
          </button>
        ) : (
          <span>{label}</span>
        )}
        {help && <HelpButton about={line.row.label} text={help} />}
      </span>
    );
  };
  const cell = (line: TableLine, value: number | null, column: ReportColumn | null, index: number | null) => {
    const percent = props.percent ? percentText(line, index) : null;
    const amount = <Amount value={value} currency={meta.currency} percent={percent} />;
    if (!isDrillRow(line.row) || value === null) return amount;
    const col = column?.key ?? 'total';
    const key = cellKey(line.row.id, col);
    const active = key === activeKey;
    // проценты читаются вместе с суммой (R6): «(12,50 %)» → «12,50 %»
    const spoken = `${cellTitle(line.row, column)}: ${moneyText(value, meta.currency)}${percent ? `, ${percent.slice(1, -1)}` : ''}`;
    return (
      <button
        type="button"
        data-cell={key}
        tabIndex={key === stop ? 0 : -1}
        aria-label={spoken}
        aria-current={active ? 'true' : undefined}
        onFocus={() => setFocused(key)}
        onClick={() => props.onCell(line.row, column)}
        className={`-mx-1.5 rounded-md px-1.5 py-0.5 text-right hover:bg-income-soft/60 focus-visible:outline-2 focus-visible:outline-focus ${active ? 'bg-income-soft ring-1 ring-income' : ''}`}
      >
        {amount}
      </button>
    );
  };
  // у блока Tab-остановка нужна, только если внутри нечему принять фокус (иначе остановка на блоке лишняя, R1)
  const innerFocusable = stop !== null || lines.some((l) => l.expandable || ROW_HELP[l.row.id]);
  return (
    // блок прокручивается сам: страница на телефоне не уезжает вбок
    <div role="region" aria-label={`${props.caption}: таблица`} tabIndex={innerFocusable ? undefined : 0} className="overflow-x-auto rounded-xl focus-visible:outline-2 focus-visible:outline-focus">
      <table aria-busy={props.busy} onKeyDown={onKeyDown} className={`w-full min-w-max border-collapse text-sm ${props.busy ? 'opacity-60' : ''}`}>
        <caption className="sr-only">{props.caption}</caption>
        <thead>
          <tr className="h-12 border-b border-field">
            {/* на телефоне колонка названий узкая, длинные названия переносятся: суммы видны без прокрутки страницы */}
            <th scope="col" className="sticky left-0 z-10 min-w-56 bg-card px-3 text-left text-xs font-semibold text-muted max-md:w-36 max-md:min-w-36">
              Название
            </th>
            {columns.map((c) => (
              <th key={c.key} scope="col" title={columnHint(c)} className="px-3 text-right text-xs font-semibold whitespace-nowrap text-muted">
                {c.label}
              </th>
            ))}
            <th scope="col" className="px-3 text-right text-xs font-semibold text-muted">
              Итого
            </th>
          </tr>
        </thead>
        <tbody>
          {lines.map((line) => {
            const { row } = line;
            if (row.id === 'balance:hidden') {
              return (
                <tr key={row.id} className="border-b border-field bg-field">
                  <td colSpan={columns.length + 2} className="px-3 py-3 text-sm text-muted">
                    {/* текст остаётся на виду при прокрутке вбок: сама ячейка занимает всю строку и не сдвигается */}
                    <span className="sticky left-0 inline-block max-w-[calc(100vw-2rem)]">{row.label}</span>
                  </td>
                </tr>
              );
            }
            const bg = ROW_BG[line.tone];
            return (
              <tr key={row.id} data-row={row.id} className={`border-b border-field ${bg}`}>
                <th scope="row" className={`sticky left-0 z-10 px-3 py-2 text-left align-middle ${bg} ${LABEL_TEXT[line.tone]}`}>
                  {renderLabel(line)}
                  {row.note && <span className="mt-0.5 block text-xs font-normal text-expense-strong">{row.note}</span>}
                </th>
                {row.values.map((v, i) => (
                  <td key={columns[i]!.key} className={`${cellClass} ${line.tone === 'group' ? 'font-bold' : ''}`}>
                    {cell(line, v, columns[i]!, i)}
                  </td>
                ))}
                <td className={`${cellClass} font-semibold`}>{cell(line, row.total, null, null)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
