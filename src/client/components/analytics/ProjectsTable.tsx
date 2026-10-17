import { useState, type KeyboardEvent, type ReactNode } from 'react';
import {
  incomeExpenseBp,
  marginPercent,
  marginText,
  parseProjectsRow,
  projectLines,
  projectRowLabel,
  projectsCellTitle,
  ratioText,
  type ProjectRow,
  type ProjectsCol,
} from '../../../shared/report-projects';
import type { ProjectsData } from '../../lib/analytics';
import { moneyText, nextCell, type CellMove } from '../../lib/report-table';

const MOVES: readonly string[] = ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Home', 'End'] satisfies CellMove[];
/** Колонки с кнопками (по порядку): название — все операции строки, «Доходы» и «Расходы» — свои операции. */
const CELL_COLS: readonly ProjectsCol[] = ['total', 'income', 'expense'];
const HEADERS = ['Доходы', 'Расходы', 'Прибыль', 'Доход / Расход, %', 'Рентабельность, %'];

/** Ключ ячейки: id строки и колонка; по нему фокус возвращается в ячейку после закрытия списка. */
export const projectsCellKey = (rowId: string, col: ProjectsCol) => `${rowId}|${col}`;

const cellClass = 'px-3 py-2 text-right align-middle whitespace-nowrap tabular-nums';

/**
 * Таблица «Проектов» (§7 спецификации «Аналитика»): «Проект», «Доходы», «Расходы», «Прибыль» = Д - Р, «Доход / Расход, %»
 * (2 знака), «Рентабельность, %» (целое); при нуле делителя — «—». Первая колонка закреплена; отрицательные суммы — красным;
 * в «Проектах с категориями» категории идут с отступом под проектом; «Всего» — выделена. Щелчок по строке, названию или
 * «Прибыли» — все операции строки, по «Доходам» и «Расходам» — их операции (§2.5); строки склада не раскрываются.
 * Кнопки ячеек — одна точка Tab (стрелки, Home и End, как у таблицы отчёта); пока показан прежний отчёт (busy), ячейки не
 * открываются.
 */
export function ProjectsTable(props: {
  data: ProjectsData;
  busy: boolean;
  /** Ячейка с открытым списком операций. */
  active: { row: string; col: ProjectsCol } | null;
  onCell: (row: ProjectRow, parent: ProjectRow | null, col: ProjectsCol) => void;
}) {
  const { currency } = props.data.meta;
  const lines = projectLines(props.data.rows, props.data.total);
  const [focused, setFocused] = useState<string | null>(null);
  const grid = lines.map((line) => CELL_COLS.map(() => parseProjectsRow(line.row.id) !== null));
  const positions = new Map<string, { row: number; col: number }>();
  lines.forEach((line, r) => CELL_COLS.forEach((col, c) => grid[r]![c] && positions.set(projectsCellKey(line.row.id, col), { row: r, col: c })));
  const first = positions.keys().next().value ?? null;
  const activeKey = props.active ? projectsCellKey(props.active.row, props.active.col) : null;
  const stop = [focused, activeKey].find((k) => k !== null && positions.has(k)) ?? first;

  const onKeyDown = (e: KeyboardEvent<HTMLTableElement>) => {
    if (e.altKey || e.ctrlKey || e.metaKey || !MOVES.includes(e.key)) return;
    const key = e.target instanceof HTMLElement ? e.target.dataset.cell : undefined;
    const from = key === undefined ? undefined : positions.get(key);
    if (!from) return;
    e.preventDefault();
    const to = nextCell(grid, from, e.key as CellMove);
    if (!to) return;
    const target = projectsCellKey(lines[to.row]!.row.id, CELL_COLS[to.col]!);
    e.currentTarget.querySelector<HTMLElement>(`[data-cell="${CSS.escape(target)}"]`)?.focus();
  };

  const open = (line: (typeof lines)[number], col: ProjectsCol) => {
    if (!props.busy) props.onCell(line.row, line.parent, col);
  };
  // у названия имя кнопки — само название (оно же имя заголовка строки), «Операции: …» — подсказкой; у сумм — «Доходы: …: ₸ …»
  const button = (line: (typeof lines)[number], col: ProjectsCol, content: ReactNode, spoken: string, align: 'left' | 'right') => {
    const key = projectsCellKey(line.row.id, col);
    if (!positions.has(key)) return content;
    return (
      <button
        type="button"
        data-cell={key}
        tabIndex={key === stop ? 0 : -1}
        aria-label={col === 'total' ? undefined : spoken}
        title={col === 'total' ? spoken : undefined}
        aria-current={key === activeKey ? 'true' : undefined}
        aria-disabled={props.busy || undefined}
        onFocus={() => setFocused(key)}
        onClick={(e) => {
          // щелчок по кнопке — её колонка, а не вся строка; фокус запоминается и без перехода на кнопку (Safari)
          e.stopPropagation();
          setFocused(key);
          open(line, col);
        }}
        className={`-mx-1.5 rounded-md px-1.5 py-0.5 ${align === 'left' ? 'text-left' : 'text-right'} hover:bg-income-soft/60 focus-visible:outline-2 focus-visible:outline-focus ${key === activeKey ? 'bg-income-soft ring-1 ring-income' : ''}`}
      >
        {content}
      </button>
    );
  };
  const money = (v: number) => <span className={v < 0 ? 'text-expense-strong' : ''}>{moneyText(v, currency)}</span>;

  return (
    // блок прокручивается сам: страница на телефоне не уезжает вбок
    <div role="region" aria-label="Проекты: таблица" className="scroll-pl-56 overflow-x-auto rounded-xl focus-visible:outline-2 focus-visible:outline-focus max-md:scroll-pl-36">
      <table aria-busy={props.busy} onKeyDown={onKeyDown} className={`w-full min-w-max border-collapse text-sm ${props.busy ? 'opacity-60' : ''}`}>
        <caption className="sr-only">Проекты</caption>
        <thead>
          <tr className="h-12 border-b border-field">
            {/* на телефоне колонка названий узкая, длинные названия переносятся */}
            <th scope="col" className="sticky left-0 z-10 min-w-56 bg-card px-3 text-left text-xs font-semibold text-muted max-md:w-36 max-md:min-w-36">
              Проект
            </th>
            {HEADERS.map((h) => (
              <th key={h} scope="col" className="px-3 text-right text-xs font-semibold whitespace-nowrap text-muted">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {lines.map((line) => {
            const { row, parent } = line;
            const total = row.kind === 'total';
            const bg = total ? 'bg-field' : 'bg-card';
            const weight = total ? 'font-bold' : row.children ? 'font-semibold' : 'font-normal';
            const profit = row.income - row.expense;
            const margin = marginPercent(profit, row.income);
            const drill = parseProjectsRow(row.id) !== null;
            const title = (col: ProjectsCol) => projectsCellTitle(row, parent, col);
            return (
              <tr
                key={row.id}
                data-row={row.id}
                onClick={drill ? () => open(line, 'total') : undefined}
                className={`border-b border-field ${bg} ${weight} ${drill ? 'cursor-pointer hover:bg-income-soft/30' : ''}`}
              >
                {/* у заголовка строки свой вес шрифта: иначе th полужирный у всех строк */}
                <th scope="row" className={`sticky left-0 z-10 px-3 py-2 text-left align-middle ${bg} ${weight} ${parent ? 'pl-8 text-muted' : ''}`}>
                  {button(line, 'total', projectRowLabel(row), title('total'), 'left')}
                </th>
                <td className={cellClass}>{button(line, 'income', money(row.income), `${title('income')}: ${moneyText(row.income, currency)}`, 'right')}</td>
                <td className={cellClass}>{button(line, 'expense', money(row.expense), `${title('expense')}: ${moneyText(row.expense, currency)}`, 'right')}</td>
                <td className={cellClass}>{money(profit)}</td>
                <td className={cellClass}>{ratioText(incomeExpenseBp(row.income, row.expense))}</td>
                <td className={`${cellClass} ${margin !== null && margin < 0 ? 'text-expense-strong' : ''}`}>{marginText(margin)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
